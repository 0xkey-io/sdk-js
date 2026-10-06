package io.zeroxkey.boundcontext

import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.util.UUID

private data class HostContext(val handle: String, val targetKey: String, val ownerId: String)

private class BoundDatabase(context: Context) :
  SQLiteOpenHelper(context, "oxkey-bound-context-v3.sqlite", null, 3) {
  init { setWriteAheadLoggingEnabled(true) }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL)")
    db.execSQL("INSERT INTO meta (id, epoch) VALUES (1, 0)")
    db.execSQL("CREATE TABLE fences (target_key TEXT PRIMARY KEY, generation INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE contexts (handle TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, target_key TEXT NOT NULL, owner_id TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, retired INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE records (target_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, active_session_key TEXT)")
    db.execSQL("CREATE TABLE sessions (target_key TEXT NOT NULL, owner_id TEXT NOT NULL, session_key TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (target_key, owner_id, session_key))")
    db.execSQL("CREATE TABLE put_events (event_id TEXT PRIMARY KEY, handle TEXT NOT NULL, runtime_id TEXT NOT NULL, target_key TEXT NOT NULL, owner_id TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, purpose TEXT NOT NULL CHECK (purpose = 'put'), operation_kind TEXT NOT NULL CHECK (operation_kind IN ('insert', 'replace')), expected_revision INTEGER NOT NULL, expected_token TEXT, session_key TEXT NOT NULL, token_digest TEXT NOT NULL, consumed INTEGER NOT NULL CHECK (consumed IN (0, 1)))")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    error("Bound session schema migration requires a reviewed native build")
  }
}

/** Host authorization is a native-only method and is not in the Expo JS method table. */
class OxkeyBoundContextModule : Module() {
  private val runtimeId = UUID.randomUUID().toString()
  private val stateLock = Any()
  private var current: HostContext? = null
  private var closed = false

  override fun definition() = ModuleDefinition {
    Name("OxkeyBoundContext")

    AsyncFunction("capability") {
      val context = activeContext() ?: return@AsyncFunction null
      try {
        withTransaction { db -> assertContext(db, context) }
      } catch (_: Exception) {
        return@AsyncFunction null
      }
      mapOf(
        "protocol" to "0xkey-bound-context-v3",
        "handle" to context.handle,
        "targetKey" to context.targetKey,
        "ownerId" to context.ownerId,
      )
    }

    AsyncFunction("read") { handle: String, targetKey: String ->
      val context = requireContext(handle, targetKey)
      withTransaction { db ->
        assertContext(db, context)
        val header = db.rawQuery(
          "SELECT owner_id, revision, active_session_key FROM records WHERE target_key = ?",
          arrayOf(targetKey),
        ).use { cursor ->
          if (!cursor.moveToFirst()) Pair(0L, null)
          else {
            check(cursor.getString(0) == context.ownerId) { "Native context owner mismatch" }
            Pair(cursor.getLong(1), if (cursor.isNull(2)) null else cursor.getString(2))
          }
        }
        val sessions = mutableListOf<Map<String, String>>()
        db.rawQuery(
          "SELECT session_key, token FROM sessions WHERE target_key = ? AND owner_id = ? ORDER BY session_key",
          arrayOf(targetKey, context.ownerId),
        ).use { cursor ->
          while (cursor.moveToNext()) {
            sessions.add(mapOf("key" to cursor.getString(0), "token" to cursor.getString(1)))
          }
        }
        mapOf("revision" to header.first, "activeSessionKey" to header.second, "sessions" to sessions)
      }
    }

    AsyncFunction("putSession") { handle: String, targetKey: String, expectedRevision: Long, sessionKey: String, expectedToken: String?, nextToken: String ->
      require(expectedRevision >= 0 && sessionKey.isNotEmpty() && nextToken.isNotEmpty() && (expectedToken == null || expectedToken.isNotEmpty())) {
        "Invalid native session mutation"
      }
      val context = requireContext(handle, targetKey)
      withTransaction { db ->
        assertContext(db, context)
        consumePutAuthorization(db, context, expectedRevision, sessionKey, expectedToken, nextToken)
        val currentRevision = recordRevision(db, context)
        if (currentRevision != expectedRevision || tokenFor(db, context, sessionKey) != expectedToken) {
          return@withTransaction "conflict"
        }
        if (currentRevision == 0L) {
          db.execSQL(
            "INSERT INTO records (target_key, owner_id, revision, active_session_key) VALUES (?, ?, 0, NULL)",
            arrayOf(targetKey, context.ownerId),
          )
        }
        if (expectedToken == null) {
          db.execSQL(
            "INSERT INTO sessions (target_key, owner_id, session_key, token) VALUES (?, ?, ?, ?)",
            arrayOf(targetKey, context.ownerId, sessionKey, nextToken),
          )
        } else {
          executeOne(db,
            "UPDATE sessions SET token = ? WHERE target_key = ? AND owner_id = ? AND session_key = ? AND token = ?",
            listOf(nextToken, targetKey, context.ownerId, sessionKey, expectedToken),
          )
        }
        executeOne(db,
          "UPDATE records SET revision = revision + 1 WHERE target_key = ? AND owner_id = ? AND revision = ?",
          listOf(targetKey, context.ownerId, currentRevision),
        )
        "committed"
      }
    }

    AsyncFunction("removeSession") { handle: String, targetKey: String, expectedRevision: Long, sessionKey: String, expectedToken: String ->
      throw IllegalStateException("Host authorization required for native remove")
    }

    AsyncFunction("setActiveSession") { handle: String, targetKey: String, expectedRevision: Long, sessionKey: String, expectedToken: String ->
      throw IllegalStateException("Host authorization required for native active selection")
    }

    AsyncFunction("retire") { handle: String ->
      val context = closeLocal(handle)
      withTransaction { db ->
        val row = db.rawQuery(
          "SELECT target_key, owner_id, epoch, generation FROM contexts WHERE handle = ? AND runtime_id = ?",
          arrayOf(handle, runtimeId),
        ).use { cursor ->
          check(cursor.moveToFirst()) { "Native context unavailable" }
          listOf(cursor.getString(0), cursor.getString(1), cursor.getLong(2).toString(), cursor.getLong(3).toString())
        }
        check(row[0] == context.targetKey && row[1] == context.ownerId) {
          "Native context mismatch"
        }
        db.execSQL("UPDATE contexts SET retired = 1 WHERE handle = ?", arrayOf(handle))
        val generation = DatabaseUtils.longForQuery(
          db, "SELECT generation FROM fences WHERE target_key = ?", arrayOf(context.targetKey),
        )
        val epoch = DatabaseUtils.longForQuery(db, "SELECT epoch FROM meta WHERE id = 1", null)
        if (generation == row[3].toLong() && epoch == row[2].toLong()) {
          val statement = db.compileStatement(
            "UPDATE fences SET generation = generation + 1 WHERE target_key = ? AND generation = ?",
          )
          try {
            statement.bindString(1, context.targetKey)
            statement.bindLong(2, generation)
            check(statement.executeUpdateDelete() == 1) { "Native retirement fence conflict" }
          } finally {
            statement.close()
          }
          db.execSQL(
            "DELETE FROM sessions WHERE target_key = ? AND owner_id = ?",
            arrayOf(context.targetKey, context.ownerId),
          )
          db.execSQL(
            "DELETE FROM records WHERE target_key = ? AND owner_id = ?",
            arrayOf(context.targetKey, context.ownerId),
          )
        }
      }
    }
  }

  /** The controlled application host calls this after its own trusted authorization event. */
  fun authorizeFromHost(targetKey: String, ownerId: String) {
    require(targetKey.startsWith("@0xkey-io/auth/v3/target/") && ownerId.isNotEmpty()) {
      "Invalid native bound target or owner"
    }
    synchronized(stateLock) {
      check(!closed && current == null) { "Native runtime already authorized or retired" }
      val handle = UUID.randomUUID().toString()
      withTransaction { db ->
        db.execSQL(
          "INSERT OR IGNORE INTO fences (target_key, generation) VALUES (?, 0)",
          arrayOf(targetKey),
        )
        db.execSQL(
          "UPDATE fences SET generation = generation + 1 WHERE target_key = ?",
          arrayOf(targetKey),
        )
        val generation = DatabaseUtils.longForQuery(
          db, "SELECT generation FROM fences WHERE target_key = ?", arrayOf(targetKey),
        )
        val epoch = DatabaseUtils.longForQuery(db, "SELECT epoch FROM meta WHERE id = 1", null)
        db.execSQL(
          "DELETE FROM sessions WHERE target_key = ? AND owner_id <> ?",
          arrayOf(targetKey, ownerId),
        )
        db.execSQL(
          "DELETE FROM records WHERE target_key = ? AND owner_id <> ?",
          arrayOf(targetKey, ownerId),
        )
        db.execSQL(
          "INSERT INTO contexts (handle, runtime_id, target_key, owner_id, epoch, generation, retired) VALUES (?, ?, ?, ?, ?, ?, 0)",
          arrayOf(handle, runtimeId, targetKey, ownerId, epoch, generation),
        )
      }
      current = HostContext(handle, targetKey, ownerId)
    }
  }

  /** Only the trusted native host may issue one exact token-changing operation. */
  fun authorizePutFromHost(targetKey: String, ownerId: String, expectedRevision: Long, sessionKey: String, expectedToken: String?, nextToken: String) {
    require(expectedRevision >= 0 && sessionKey.isNotEmpty() && nextToken.isNotEmpty() && (expectedToken == null || expectedToken.isNotEmpty())) {
      "Invalid native put authorization"
    }
    synchronized(stateLock) {
      val context = current
      check(!closed && context != null && context.targetKey == targetKey && context.ownerId == ownerId) {
        "Native context unavailable"
      }
      withTransaction { db ->
        assertContext(db, context)
        val (epoch, generation) = contextFence(db, context)
        db.execSQL("DELETE FROM put_events WHERE handle = ?", arrayOf(context.handle))
        db.execSQL(
          "INSERT INTO put_events (event_id, handle, runtime_id, target_key, owner_id, epoch, generation, purpose, operation_kind, expected_revision, expected_token, session_key, token_digest, consumed) VALUES (?, ?, ?, ?, ?, ?, ?, 'put', ?, ?, ?, ?, ?, 0)",
          arrayOf(UUID.randomUUID().toString(), context.handle, runtimeId, targetKey,
            ownerId, epoch, generation, if (expectedToken == null) "insert" else "replace",
            expectedRevision, expectedToken, sessionKey, tokenDigest(nextToken)),
        )
      }
    }
  }

  /** Host sign-out entry point. No JavaScript bridge or host event calls this yet. */
  fun clearAllFromHost() {
    synchronized(stateLock) { closed = true }
    withTransaction { db ->
      executeOne(db, "UPDATE meta SET epoch = epoch + 1 WHERE id = 1", emptyList())
      db.execSQL("DELETE FROM sessions")
      db.execSQL("DELETE FROM records")
      db.execSQL("UPDATE contexts SET retired = 1")
    }
  }

  private fun activeContext(): HostContext? = synchronized(stateLock) {
    if (closed) null else current
  }

  private fun requireContext(handle: String, targetKey: String): HostContext {
    val context = activeContext()
    check(context != null && context.handle == handle && context.targetKey == targetKey) {
      "Native context unavailable"
    }
    return context
  }

  private fun closeLocal(handle: String): HostContext = synchronized(stateLock) {
    val context = current
    check(!closed && context != null && context.handle == handle) { "Native context unavailable" }
    closed = true
    context
  }

  private fun assertContext(db: SQLiteDatabase, context: HostContext) {
    db.rawQuery(
      "SELECT c.target_key, c.owner_id FROM contexts c JOIN fences f ON f.target_key = c.target_key AND f.generation = c.generation JOIN meta m ON m.epoch = c.epoch WHERE c.handle = ? AND c.runtime_id = ? AND c.retired = 0",
      arrayOf(context.handle, runtimeId),
    ).use { cursor ->
      check(cursor.moveToFirst() && cursor.getString(0) == context.targetKey && cursor.getString(1) == context.ownerId) {
        "Native context retired"
      }
    }
  }

  private fun recordRevision(db: SQLiteDatabase, context: HostContext): Long = db.rawQuery(
    "SELECT owner_id, revision FROM records WHERE target_key = ?", arrayOf(context.targetKey),
  ).use { cursor ->
    if (!cursor.moveToFirst()) 0L
    else {
      check(cursor.getString(0) == context.ownerId) { "Native context owner mismatch" }
      cursor.getLong(1)
    }
  }

  private fun tokenFor(db: SQLiteDatabase, context: HostContext, sessionKey: String): String? = db.rawQuery(
    "SELECT token FROM sessions WHERE target_key = ? AND owner_id = ? AND session_key = ?",
    arrayOf(context.targetKey, context.ownerId, sessionKey),
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  private fun tokenDigest(token: String): String = MessageDigest.getInstance("SHA-256")
    .digest(token.toByteArray(Charsets.UTF_8))
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

  private fun contextFence(db: SQLiteDatabase, context: HostContext): Pair<Long, Long> = db.rawQuery(
    "SELECT epoch, generation FROM contexts WHERE handle = ? AND runtime_id = ? AND retired = 0",
    arrayOf(context.handle, runtimeId),
  ).use { cursor ->
    check(cursor.moveToFirst()) { "Native context retired" }
    Pair(cursor.getLong(0), cursor.getLong(1))
  }

  private fun consumePutAuthorization(db: SQLiteDatabase, context: HostContext, expectedRevision: Long, sessionKey: String, expectedToken: String?, nextToken: String) {
    val (epoch, generation) = contextFence(db, context)
    executeOne(db,
      "UPDATE put_events SET consumed = 1 WHERE handle = ? AND runtime_id = ? AND target_key = ? AND owner_id = ? AND epoch = ? AND generation = ? AND purpose = 'put' AND operation_kind = ? AND expected_revision = ? AND expected_token IS ? AND session_key = ? AND token_digest = ? AND consumed = 0",
      listOf(context.handle, runtimeId, context.targetKey, context.ownerId, epoch,
        generation, if (expectedToken == null) "insert" else "replace", expectedRevision,
        expectedToken, sessionKey, tokenDigest(nextToken)),
    )
  }

  private fun executeOne(db: SQLiteDatabase, sql: String, values: List<Any?>) {
    val statement = db.compileStatement(sql)
    try {
      values.forEachIndexed { index, value ->
        when (value) {
          null -> statement.bindNull(index + 1)
          is String -> statement.bindString(index + 1, value)
          is Long -> statement.bindLong(index + 1, value)
          else -> error("Unsupported native SQL argument")
        }
      }
      check(statement.executeUpdateDelete() == 1) { "Native conditional mutation conflict" }
    } finally {
      statement.close()
    }
  }

  private fun <T> withTransaction(body: (SQLiteDatabase) -> T): T {
    val context = appContext.reactContext?.applicationContext
      ?: error("Native React context unavailable")
    BoundDatabase(context).use { helper ->
      val db = helper.writableDatabase
      db.beginTransaction()
      try {
        val result = body(db)
        db.setTransactionSuccessful()
        return result
      } finally {
        db.endTransaction()
      }
    }
  }
}
