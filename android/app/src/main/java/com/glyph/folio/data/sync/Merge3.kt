package com.glyph.folio.data.sync

data class MergeResult(val merged: String, val hasConflicts: Boolean)

/**
 * Line-based 3-way merge, the Kotlin twin of desktop/src/renderer/lib/merge3.ts (node-diff3).
 *
 * base   = what both sides last agreed on (the sync base)
 * local  = this device's edits since then
 * remote = the server's edits since then
 *
 * Non-overlapping changes merge cleanly. Overlapping ones get the same comment-style markers
 * as desktop, so Typst still compiles a conflicted note.
 */
object Merge3 {
    const val MARK_LOCAL = "// <<<<<<< local"
    const val MARK_SEP = "// ======="
    const val MARK_SERVER = "// >>>>>>> server"

    fun merge(base: String, local: String, remote: String): MergeResult {
        val o = base.split("\n")
        val a = local.split("\n")
        val b = remote.split("\n")
        val out = ArrayList<String>()
        var conflicts = false
        for (chunk in diff3(a, o, b)) {
            when (chunk) {
                is Chunk.Ok -> out += chunk.lines
                is Chunk.Conflict -> {
                    conflicts = true
                    out += MARK_LOCAL; out += chunk.a; out += MARK_SEP; out += chunk.b; out += MARK_SERVER
                }
            }
        }
        return MergeResult(out.joinToString("\n"), conflicts)
    }

    sealed interface Chunk {
        data class Ok(val lines: List<String>) : Chunk
        data class Conflict(val a: List<String>, val o: List<String>, val b: List<String>) : Chunk
    }

    /** A changed region: base[oStart, oStart+oLen) became side[sStart, sStart+sLen). */
    internal data class Hunk(val oStart: Int, val oLen: Int, val sStart: Int, val sLen: Int, val sideA: Boolean) {
        val oEnd get() = oStart + oLen
        val delta get() = sLen - oLen
    }

    fun diff3(a: List<String>, o: List<String>, b: List<String>): List<Chunk> {
        val hunks = (diff(o, a, sideA = true) + diff(o, b, sideA = false))
            .sortedWith(compareBy<Hunk> { it.oStart }.thenBy { if (it.sideA) 0 else 1 })

        val chunks = ArrayList<Chunk>()
        val okBuf = ArrayList<String>()
        fun flushOk() { if (okBuf.isNotEmpty()) { chunks += Chunk.Ok(ArrayList(okBuf)); okBuf.clear() } }

        var oPos = 0
        var deltaA = 0 // cumulative (side length − base length) of hunks already consumed
        var deltaB = 0
        var i = 0
        while (i < hunks.size) {
            val first = hunks[i]
            val regionStart = first.oStart
            var regionEnd = first.oEnd
            val region = arrayListOf(first)
            i++
            // Same grouping rule as node-diff3: touching or overlapping hunks form one region.
            while (i < hunks.size && hunks[i].oStart <= regionEnd) {
                regionEnd = maxOf(regionEnd, hunks[i].oEnd)
                region += hunks[i]
                i++
            }

            // Unchanged base lines before this region.
            for (k in oPos until regionStart) okBuf += o[k]
            oPos = regionEnd

            val regionDeltaA = region.filter { it.sideA }.sumOf { it.delta }
            val regionDeltaB = region.filter { !it.sideA }.sumOf { it.delta }
            val aSlice = a.subList(regionStart + deltaA, regionEnd + deltaA + regionDeltaA)
            val bSlice = b.subList(regionStart + deltaB, regionEnd + deltaB + regionDeltaB)
            deltaA += regionDeltaA
            deltaB += regionDeltaB

            val onlyA = region.all { it.sideA }
            val onlyB = region.none { it.sideA }
            when {
                onlyA -> okBuf += aSlice
                onlyB -> okBuf += bSlice
                aSlice == bSlice -> okBuf += aSlice // both sides made the same change
                else -> {
                    flushOk()
                    chunks += Chunk.Conflict(aSlice, o.subList(regionStart, regionEnd), bSlice)
                }
            }
        }
        for (k in oPos until o.size) okBuf += o[k]
        flushOk()
        return chunks
    }

    /** LCS line diff of [o] → [s], returned as change hunks. */
    internal fun diff(o: List<String>, s: List<String>, sideA: Boolean): List<Hunk> {
        // Trim the common prefix/suffix so the quadratic part only sees the edited middle.
        var pre = 0
        while (pre < o.size && pre < s.size && o[pre] == s[pre]) pre++
        var suf = 0
        while (suf < o.size - pre && suf < s.size - pre && o[o.size - 1 - suf] == s[s.size - 1 - suf]) suf++
        val n = o.size - pre - suf
        val m = s.size - pre - suf
        if (n == 0 && m == 0) return emptyList()
        if (n == 0 || m == 0 || n.toLong() * m > 4_000_000L) {
            // Pure insertion/deletion, or too big to diff finely: one hunk for the whole middle.
            return listOf(Hunk(pre, n, pre, m, sideA))
        }

        // lcs[i][j] = LCS length of o[pre+i..] and s[pre+j..]
        val lcs = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) {
            lcs[i][j] = if (o[pre + i] == s[pre + j]) lcs[i + 1][j + 1] + 1
            else maxOf(lcs[i + 1][j], lcs[i][j + 1])
        }

        val hunks = ArrayList<Hunk>()
        var i = 0
        var j = 0
        var hoStart = -1
        var hsStart = -1
        fun close() {
            if (hoStart >= 0) {
                hunks += Hunk(pre + hoStart, i - hoStart, pre + hsStart, j - hsStart, sideA)
                hoStart = -1
            }
        }
        while (i < n || j < m) {
            if (i < n && j < m && o[pre + i] == s[pre + j]) {
                close(); i++; j++
            } else {
                if (hoStart < 0) { hoStart = i; hsStart = j }
                if (j < m && (i == n || lcs[i][j + 1] >= lcs[i + 1][j])) j++ else i++
            }
        }
        close()
        return hunks
    }
}
