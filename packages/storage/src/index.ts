import { Database } from "./database";
import { migrate } from "./migrations";
import { CredentialRepository } from "./credential-repository";
import { ProviderRepository } from "./provider-repository";
import { SessionRepository } from "./session-repository";
import { RunRepository } from "./run-repository";
export function openStore(path: string) {
  const db = new Database(path);
  migrate(db);
  const sessions = new SessionRepository(db);
  return {
    credentials: new CredentialRepository(db),
    providers: new ProviderRepository(db),
    sessions,
    runs: new RunRepository(db, sessions),
    transaction: <T>(operation: () => T) => db.transaction(operation),
    close: () => db.close(),
  };
}
export type Store = ReturnType<typeof openStore>;
export { namespaceKey } from "./namespace";
export { CredentialRepository } from "./credential-repository";
export { ProviderRepository } from "./provider-repository";
export { SessionRepository } from "./session-repository";
export { RunRepository, activeStatuses } from "./run-repository";
