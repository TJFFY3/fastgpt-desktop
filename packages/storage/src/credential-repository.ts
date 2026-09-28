import type { Namespace } from "../../shared/src/index";
import type { Database } from "./database";
import { namespaceKey } from "./namespace";
export class CredentialRepository {
  constructor(private db: Database) {}
  put(n: Namespace, ref: string, ciphertext: Uint8Array) {
    this.db.raw
      .prepare("INSERT OR REPLACE INTO credentials VALUES(?,?,?)")
      .run(namespaceKey(n), ref, ciphertext);
  }
  get(n: Namespace, ref: string): Uint8Array | null {
    const row = this.db.raw
      .prepare(
        "SELECT ciphertext FROM credentials WHERE namespace_key=? AND ref=?",
      )
      .get(namespaceKey(n), ref);
    return row ? new Uint8Array(row.ciphertext as Uint8Array) : null;
  }
  remove(n: Namespace, ref: string) {
    this.db.raw
      .prepare("DELETE FROM credentials WHERE namespace_key=? AND ref=?")
      .run(namespaceKey(n), ref);
  }
}
