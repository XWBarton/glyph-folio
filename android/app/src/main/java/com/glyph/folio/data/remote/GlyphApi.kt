package com.glyph.folio.data.remote

import retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import java.util.concurrent.TimeUnit

@Serializable data class HealthDto(val ok: Boolean = false, val version: String? = null)
@Serializable data class NoteMetaDto(val id: String, val title: String = "", val modifiedAt: String)
@Serializable data class NoteDto(val id: String, val title: String = "", val body: String, val modifiedAt: String)
@Serializable data class PutNoteDto(val body: String)
@Serializable data class OkDto(val ok: Boolean = false)
@Serializable data class CompileRequestDto(val content: String, val noteId: String? = null, val citationStyle: String? = null)
@Serializable data class CompileResponseDto(val ok: Boolean = false, val pdfBase64: String? = null, val error: String? = null)

/** REST surface of server/src/index.ts. */
interface GlyphApi {
    @GET("api/health") suspend fun health(): HealthDto
    @GET("api/notes") suspend fun listNotes(): List<NoteMetaDto>
    @GET("api/notes/{id}") suspend fun getNote(@Path("id") id: String): NoteDto
    @PUT("api/notes/{id}") suspend fun putNote(@Path("id") id: String, @Body body: PutNoteDto): OkDto
    @DELETE("api/notes/{id}") suspend fun deleteNote(@Path("id") id: String): OkDto
    @POST("api/compile") suspend fun compile(@Body body: CompileRequestDto): CompileResponseDto

    companion object {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

        private val baseClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS) // compiles can be slow
            .build()

        fun create(baseUrl: String, token: String): GlyphApi {
            val client = baseClient.newBuilder().addInterceptor { chain ->
                val req = chain.request().newBuilder()
                if (token.isNotBlank()) req.header("Authorization", "Bearer $token")
                chain.proceed(req.build())
            }.build()
            return Retrofit.Builder()
                .baseUrl(baseUrl.trimEnd('/') + "/")
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(GlyphApi::class.java)
        }
    }
}
