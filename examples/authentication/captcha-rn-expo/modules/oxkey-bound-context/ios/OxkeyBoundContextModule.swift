import ExpoModulesCore
import Foundation
import SQLite3
import CryptoKit

private enum BoundError: Error {
  case closed
  case invalidContext
  case invalidTarget
  case hostAuthorizationRequired
  case database(String)
}

private struct HostContext {
  let handle: String
  let targetKey: String
  let ownerId: String
}

/** The host, never JavaScript, must call authorizeFromHost after a trusted login or recovery event. */
public final class OxkeyBoundContextModule: Module {
  private let runtimeId = UUID().uuidString
  private let stateLock = NSLock()
  private var current: HostContext?
  private var closed = false

  public func definition() -> ModuleDefinition {
    Name("OxkeyBoundContext")

    AsyncFunction("capability") { () -> [String: String]? in
      guard let context = self.activeContext() else { return nil }
      do {
        try self.withTransaction { db in
          try self.assertContext(db, context)
        }
      } catch {
        return nil
      }
      return [
        "protocol": "0xkey-bound-context-v3",
        "handle": context.handle,
        "targetKey": context.targetKey,
        "ownerId": context.ownerId,
      ]
    }

    AsyncFunction("read") { (handle: String, targetKey: String) throws -> [String: Any] in
      let context = try self.requireContext(handle, targetKey)
      return try self.withTransaction { db in
        try self.assertContext(db, context)
        let row = try self.first(db,
          "SELECT owner_id, revision, active_session_key FROM records WHERE target_key = ?",
          [targetKey])
        let revision: Int
        let active: Any
        if let row {
          guard row[0] == context.ownerId, let parsed = Int(row[1] ?? "") else {
            throw BoundError.invalidContext
          }
          revision = parsed
          active = row[2].map { $0 as Any } ?? NSNull()
        } else {
          revision = 0
          active = NSNull()
        }
        let sessions = try self.rows(db,
          "SELECT session_key, token FROM sessions WHERE target_key = ? AND owner_id = ? ORDER BY session_key",
          [targetKey, context.ownerId]).map { entry -> [String: String] in
            guard let key = entry[0], let token = entry[1] else {
              throw BoundError.invalidContext
            }
            return ["key": key, "token": token]
          }
        return ["revision": revision, "activeSessionKey": active, "sessions": sessions]
      }
    }

    AsyncFunction("putSession") { (handle: String, targetKey: String, expectedRevision: Int, sessionKey: String, expectedToken: String?, nextToken: String) throws -> String in
      guard expectedRevision >= 0, !sessionKey.isEmpty, !nextToken.isEmpty,
            expectedToken == nil || !expectedToken!.isEmpty else { throw BoundError.invalidContext }
      let context = try self.requireContext(handle, targetKey)
      return try self.withTransaction { db in
        try self.assertContext(db, context)
        try self.consumePutAuthorization(db, context, expectedRevision, sessionKey, expectedToken, nextToken)
        let revision = try self.recordRevision(db, context)
        let actual = try self.sessionToken(db, context, sessionKey)
        if revision != expectedRevision || actual != expectedToken { return "conflict" }
        if revision == 0 {
          try self.execute(db, "INSERT INTO records (target_key, owner_id, revision, active_session_key) VALUES (?, ?, 0, NULL)",
            [targetKey, context.ownerId])
        }
        if expectedToken == nil {
          try self.execute(db,
            "INSERT INTO sessions (target_key, owner_id, session_key, token) VALUES (?, ?, ?, ?)",
            [targetKey, context.ownerId, sessionKey, nextToken])
        } else {
          try self.execute(db,
            "UPDATE sessions SET token = ? WHERE target_key = ? AND owner_id = ? AND session_key = ? AND token = ?",
            [nextToken, targetKey, context.ownerId, sessionKey, expectedToken])
          guard sqlite3_changes(db) == 1 else { throw BoundError.invalidContext }
        }
        try self.execute(db,
          "UPDATE records SET revision = revision + 1 WHERE target_key = ? AND owner_id = ? AND revision = ?",
          [targetKey, context.ownerId, String(revision)])
        guard sqlite3_changes(db) == 1 else { throw BoundError.invalidContext }
        return "committed"
      }
    }

    AsyncFunction("removeSession") { (handle: String, targetKey: String, expectedRevision: Int, sessionKey: String, expectedToken: String) throws -> String in
      throw BoundError.hostAuthorizationRequired
    }

    AsyncFunction("setActiveSession") { (handle: String, targetKey: String, expectedRevision: Int, sessionKey: String, expectedToken: String) throws -> String in
      throw BoundError.hostAuthorizationRequired
    }

    AsyncFunction("retire") { (handle: String) throws in
      let context = try self.closeLocal(handle)
      try self.withTransaction { db in
        let row = try self.first(db,
          "SELECT target_key, owner_id, epoch, generation FROM contexts WHERE handle = ? AND runtime_id = ?",
          [handle, self.runtimeId])
        guard let row, row[0] == context.targetKey, row[1] == context.ownerId,
              let epoch = Int(row[2] ?? ""), let generation = Int(row[3] ?? "") else { throw BoundError.invalidContext }
        try self.execute(db, "UPDATE contexts SET retired = 1 WHERE handle = ?", [handle])
        let fence = try self.first(db,
          "SELECT generation FROM fences WHERE target_key = ?", [context.targetKey])
        let meta = try self.first(db, "SELECT epoch FROM meta WHERE id = 1", [])
        if let fenceValue = fence?.first ?? nil, let epochValue = meta?.first ?? nil,
           Int(fenceValue) == generation, Int(epochValue) == epoch {
          try self.execute(db,
            "UPDATE fences SET generation = generation + 1 WHERE target_key = ? AND generation = ?",
            [context.targetKey, String(generation)])
          guard sqlite3_changes(db) == 1 else { throw BoundError.invalidContext }
          try self.execute(db,
            "DELETE FROM sessions WHERE target_key = ? AND owner_id = ?",
            [context.targetKey, context.ownerId])
          try self.execute(db,
            "DELETE FROM records WHERE target_key = ? AND owner_id = ?",
            [context.targetKey, context.ownerId])
        }
      }
    }
  }

  /** Native host entry point. It is deliberately absent from the Expo method table. */
  public func authorizeFromHost(targetKey: String, ownerId: String) throws {
    guard targetKey.hasPrefix("@0xkey-io/auth/v3/target/"), !ownerId.isEmpty else {
      throw BoundError.invalidTarget
    }
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !closed, current == nil else { throw BoundError.closed }
    let handle = UUID().uuidString
    try withTransaction { db in
      try execute(db,
        "INSERT OR IGNORE INTO fences (target_key, generation) VALUES (?, 0)",
        [targetKey])
      try execute(db,
        "UPDATE fences SET generation = generation + 1 WHERE target_key = ?",
        [targetKey])
      let fence = try first(db,
        "SELECT generation FROM fences WHERE target_key = ?", [targetKey])
      guard let generation = fence?.first ?? nil else { throw BoundError.invalidContext }
      let meta = try first(db, "SELECT epoch FROM meta WHERE id = 1", [])
      guard let epoch = meta?.first ?? nil else { throw BoundError.invalidContext }
      try execute(db,
        "DELETE FROM sessions WHERE target_key = ? AND owner_id <> ?",
        [targetKey, ownerId])
      try execute(db,
        "DELETE FROM records WHERE target_key = ? AND owner_id <> ?",
        [targetKey, ownerId])
      try execute(db,
        "INSERT INTO contexts (handle, runtime_id, target_key, owner_id, epoch, generation, retired) VALUES (?, ?, ?, ?, ?, ?, 0)",
        [handle, runtimeId, targetKey, ownerId, epoch, generation])
    }
    current = HostContext(handle: handle, targetKey: targetKey, ownerId: ownerId)
  }

  /** Only the trusted native host may issue one exact token-changing operation. */
  public func authorizePutFromHost(targetKey: String, ownerId: String, expectedRevision: Int, sessionKey: String, expectedToken: String?, nextToken: String) throws {
    guard expectedRevision >= 0, !sessionKey.isEmpty, !nextToken.isEmpty,
          expectedToken == nil || !expectedToken!.isEmpty else { throw BoundError.invalidContext }
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !closed, let context = current, context.targetKey == targetKey,
          context.ownerId == ownerId else { throw BoundError.invalidContext }
    try withTransaction { db in
      try assertContext(db, context)
      let row = try first(db,
        "SELECT epoch, generation FROM contexts WHERE handle = ? AND runtime_id = ? AND retired = 0",
        [context.handle, runtimeId])
      guard let row, let epoch = row[0], let generation = row[1] else {
        throw BoundError.invalidContext
      }
      try execute(db, "DELETE FROM put_events WHERE handle = ?", [context.handle])
      try execute(db,
        "INSERT INTO put_events (event_id, handle, runtime_id, target_key, owner_id, epoch, generation, purpose, operation_kind, expected_revision, expected_token, session_key, token_digest, consumed) VALUES (?, ?, ?, ?, ?, ?, ?, 'put', ?, ?, ?, ?, ?, 0)",
        [UUID().uuidString, context.handle, runtimeId, targetKey, ownerId, epoch,
         generation, expectedToken == nil ? "insert" : "replace", String(expectedRevision),
         expectedToken, sessionKey, tokenDigest(nextToken)])
    }
  }

  /** Host sign-out entry point. No JavaScript bridge or host event calls this yet. */
  public func clearAllFromHost() throws {
    stateLock.lock()
    closed = true
    stateLock.unlock()
    try withTransaction { db in
      try execute(db, "UPDATE meta SET epoch = epoch + 1 WHERE id = 1", [])
      guard sqlite3_changes(db) == 1 else { throw BoundError.invalidContext }
      try execute(db, "DELETE FROM sessions", [])
      try execute(db, "DELETE FROM records", [])
      try execute(db, "UPDATE contexts SET retired = 1", [])
    }
  }

  private func activeContext() -> HostContext? {
    stateLock.lock()
    defer { stateLock.unlock() }
    return closed ? nil : current
  }

  private func requireContext(_ handle: String, _ targetKey: String) throws -> HostContext {
    guard let context = activeContext(), context.handle == handle,
          context.targetKey == targetKey else { throw BoundError.invalidContext }
    return context
  }

  private func closeLocal(_ handle: String) throws -> HostContext {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !closed, let context = current, context.handle == handle else {
      throw BoundError.invalidContext
    }
    closed = true
    return context
  }

  private func assertContext(_ db: OpaquePointer?, _ context: HostContext) throws {
    let row = try first(db,
      "SELECT c.target_key, c.owner_id FROM contexts c JOIN fences f ON f.target_key = c.target_key AND f.generation = c.generation JOIN meta m ON m.epoch = c.epoch WHERE c.handle = ? AND c.runtime_id = ? AND c.retired = 0",
      [context.handle, runtimeId])
    guard let row, row[0] == context.targetKey, row[1] == context.ownerId else {
      throw BoundError.invalidContext
    }
  }

  private func recordRevision(_ db: OpaquePointer?, _ context: HostContext) throws -> Int {
    let row = try first(db,
      "SELECT owner_id, revision FROM records WHERE target_key = ?", [context.targetKey])
    guard let row else { return 0 }
    guard row[0] == context.ownerId, let revision = Int(row[1] ?? "") else {
      throw BoundError.invalidContext
    }
    return revision
  }

  private func sessionToken(_ db: OpaquePointer?, _ context: HostContext, _ key: String) throws -> String? {
    let row = try first(db,
      "SELECT token FROM sessions WHERE target_key = ? AND owner_id = ? AND session_key = ?",
      [context.targetKey, context.ownerId, key])
    return row?.first ?? nil
  }

  private func tokenDigest(_ token: String) -> String {
    SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func consumePutAuthorization(_ db: OpaquePointer?, _ context: HostContext, _ expectedRevision: Int, _ sessionKey: String, _ expectedToken: String?, _ nextToken: String) throws {
    let row = try first(db,
      "SELECT epoch, generation FROM contexts WHERE handle = ? AND runtime_id = ? AND retired = 0",
      [context.handle, runtimeId])
    guard let row, let epoch = row[0], let generation = row[1] else {
      throw BoundError.invalidContext
    }
    try execute(db,
      "UPDATE put_events SET consumed = 1 WHERE handle = ? AND runtime_id = ? AND target_key = ? AND owner_id = ? AND epoch = ? AND generation = ? AND purpose = 'put' AND operation_kind = ? AND expected_revision = ? AND expected_token IS ? AND session_key = ? AND token_digest = ? AND consumed = 0",
      [context.handle, runtimeId, context.targetKey, context.ownerId, epoch,
       generation, expectedToken == nil ? "insert" : "replace", String(expectedRevision),
       expectedToken, sessionKey, tokenDigest(nextToken)])
    guard sqlite3_changes(db) == 1 else { throw BoundError.invalidContext }
  }

  private func withTransaction<T>(_ body: (OpaquePointer?) throws -> T) throws -> T {
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let path = directory.appendingPathComponent("oxkey-bound-context-v3.sqlite").path
    var db: OpaquePointer?
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      defer { sqlite3_close(db) }
      throw BoundError.database("open failed")
    }
    defer { sqlite3_close(db) }
    try exec(db, "PRAGMA journal_mode=WAL")
    try exec(db, "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL)")
    try exec(db, "INSERT OR IGNORE INTO meta (id, epoch) VALUES (1, 0)")
    try exec(db, "CREATE TABLE IF NOT EXISTS fences (target_key TEXT PRIMARY KEY, generation INTEGER NOT NULL)")
    try exec(db, "CREATE TABLE IF NOT EXISTS contexts (handle TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, target_key TEXT NOT NULL, owner_id TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, retired INTEGER NOT NULL)")
    try exec(db, "CREATE TABLE IF NOT EXISTS records (target_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, active_session_key TEXT)")
    try exec(db, "CREATE TABLE IF NOT EXISTS sessions (target_key TEXT NOT NULL, owner_id TEXT NOT NULL, session_key TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (target_key, owner_id, session_key))")
    try exec(db, "CREATE TABLE IF NOT EXISTS put_events (event_id TEXT PRIMARY KEY, handle TEXT NOT NULL, runtime_id TEXT NOT NULL, target_key TEXT NOT NULL, owner_id TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, purpose TEXT NOT NULL CHECK (purpose = 'put'), operation_kind TEXT NOT NULL CHECK (operation_kind IN ('insert', 'replace')), expected_revision INTEGER NOT NULL, expected_token TEXT, session_key TEXT NOT NULL, token_digest TEXT NOT NULL, consumed INTEGER NOT NULL CHECK (consumed IN (0, 1)))")
    try exec(db, "BEGIN IMMEDIATE")
    do {
      let result = try body(db)
      try exec(db, "COMMIT")
      return result
    } catch {
      _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
      throw error
    }
  }

  private func exec(_ db: OpaquePointer?, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
      throw BoundError.database(String(cString: sqlite3_errmsg(db)))
    }
  }

  private func execute(_ db: OpaquePointer?, _ sql: String, _ values: [String?]) throws {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
      throw BoundError.database(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    for (index, value) in values.enumerated() {
      if let value {
        let result = value.withCString {
          sqlite3_bind_text(statement, Int32(index + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        guard result == SQLITE_OK else { throw BoundError.database("bind failed") }
      } else {
        guard sqlite3_bind_null(statement, Int32(index + 1)) == SQLITE_OK else {
          throw BoundError.database("bind failed")
        }
      }
    }
    guard sqlite3_step(statement) == SQLITE_DONE else {
      throw BoundError.database(String(cString: sqlite3_errmsg(db)))
    }
  }

  private func first(_ db: OpaquePointer?, _ sql: String, _ values: [String?]) throws -> [String?]? {
    return try rows(db, sql, values).first
  }

  private func rows(_ db: OpaquePointer?, _ sql: String, _ values: [String?]) throws -> [[String?]] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
      throw BoundError.database(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    for (index, value) in values.enumerated() {
      if let value {
        let result = value.withCString {
          sqlite3_bind_text(statement, Int32(index + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        guard result == SQLITE_OK else { throw BoundError.database("bind failed") }
      }
    }
    var result: [[String?]] = []
    while true {
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { return result }
      guard step == SQLITE_ROW else {
        throw BoundError.database(String(cString: sqlite3_errmsg(db)))
      }
      result.append((0..<sqlite3_column_count(statement)).map { index in
        guard let text = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: UnsafeRawPointer(text).assumingMemoryBound(to: CChar.self))
      })
    }
  }
}
