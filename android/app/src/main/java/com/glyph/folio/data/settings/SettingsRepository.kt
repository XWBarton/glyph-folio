package com.glyph.folio.data.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first

enum class SyncMode { LOCAL, SERVER }
enum class CitationStyle(val wire: String, val label: String) {
    AUTHOR_DATE("author-date", "Author–Date"),
    NUMBERED("numbered", "Numbered"),
}

data class AppSettings(
    val syncMode: SyncMode = SyncMode.LOCAL,
    val serverUrl: String = "",
    val authToken: String = "",
    val citationStyle: CitationStyle = CitationStyle.AUTHOR_DATE,
) {
    val serverEnabled get() = syncMode == SyncMode.SERVER && serverUrl.isNotBlank()
    val normalizedServerUrl get() = normalizeUrl(serverUrl.trim()).trimEnd('/')
}

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val context: Context) {
    private object Keys {
        val syncMode = stringPreferencesKey("syncMode")
        val serverUrl = stringPreferencesKey("serverUrl")
        val citationStyle = stringPreferencesKey("citationStyle")
        val tutorialSeeded = booleanPreferencesKey("tutorialSeeded")
    }

    /** The auth token lives in encrypted prefs, not in plain DataStore. */
    private val secure: SharedPreferences by lazy {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "secure_settings", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
    private val token = MutableStateFlow<String?>(null)

    private fun loadToken(): String =
        token.value ?: runCatching { secure.getString("authToken", "") ?: "" }.getOrDefault("").also { token.value = it }

    val settings: Flow<AppSettings> = combine(context.dataStore.data, token) { p, _ ->
        AppSettings(
            syncMode = if (p[Keys.syncMode] == "server") SyncMode.SERVER else SyncMode.LOCAL,
            serverUrl = p[Keys.serverUrl] ?: "",
            authToken = loadToken(),
            citationStyle = CitationStyle.entries.firstOrNull { it.wire == p[Keys.citationStyle] }
                ?: CitationStyle.AUTHOR_DATE,
        )
    }

    suspend fun current(): AppSettings = settings.first()

    suspend fun save(s: AppSettings) {
        runCatching { secure.edit().putString("authToken", s.authToken).apply() }
        token.value = s.authToken
        context.dataStore.edit {
            it[Keys.syncMode] = if (s.syncMode == SyncMode.SERVER) "server" else "local"
            it[Keys.serverUrl] = s.serverUrl.trim()
            it[Keys.citationStyle] = s.citationStyle.wire
        }
    }

    suspend fun tutorialSeeded(): Boolean = context.dataStore.data.first()[Keys.tutorialSeeded] == true
    suspend fun markTutorialSeeded() { context.dataStore.edit { it[Keys.tutorialSeeded] = true } }
}

/**
 * Same rule as desktop `normalizeUrl`: upgrade http → https unless the host is clearly local
 * (private IP, bare hostname, .local/.lan/.home/.internal, or an explicit port).
 */
fun normalizeUrl(url: String): String {
    if (url.isEmpty()) return url
    if (!url.startsWith("http://") && !url.startsWith("https://")) return normalizeUrl("http://$url")
    if (url.startsWith("http://")) {
        val hostPort = url.substring(7).substringBefore('/')
        val host = hostPort.substringBefore(':')
        val isLocal = host == "localhost" || host == "127.0.0.1" ||
            host.startsWith("192.168.") || host.startsWith("10.") ||
            Regex("""^172\.(1[6-9]|2\d|3[01])\.""").containsMatchIn(host) ||
            Regex("""^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.""").containsMatchIn(host) || // Tailscale CGNAT
            !host.contains('.') ||
            Regex("""\.(local|lan|home|internal|ts\.net)$""", RegexOption.IGNORE_CASE).containsMatchIn(host) ||
            hostPort.contains(':')
        if (!isLocal) return "https://" + url.substring(7)
    }
    return url
}
