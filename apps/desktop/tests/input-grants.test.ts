import { expect, test } from "vitest";
import { InputGrants } from "../src/main/files/input-grants";
import { namespaceA as n,namespaceB as foreign } from "../../../tests/fixtures/data";
test("a native selection grant is bound to identity, session and window and can be consumed only once",()=>{
  const grants=new InputGrants(()=>100),id=grants.issue(n,"s",10,["/selected/note.txt"]);
  expect(()=>grants.consume(id,foreign,"s",10)).toThrow(/PERMISSION_DENIED/);
  expect(()=>grants.consume(id,n,"other",10)).toThrow(/PERMISSION_DENIED/);
  expect(()=>grants.consume(id,n,"s",11)).toThrow(/PERMISSION_DENIED/);
  expect(grants.consume(id,n,"s",10)).toEqual(["/selected/note.txt"]);
  expect(()=>grants.consume(id,n,"s",10)).toThrow(/PERMISSION_DENIED/);
});
test("expired and revoked file grants cannot be replayed",()=>{
  let now=0;const grants=new InputGrants(()=>now),id=grants.issue(n,"s",10,["/selected/note.txt"]);
  now=60001;expect(()=>grants.consume(id,n,"s",10)).toThrow(/PERMISSION_DENIED/);
  const next=grants.issue(n,"s",10,["/selected/note.txt"]);grants.revokeSession(n,"s");expect(()=>grants.consume(next,n,"s",10)).toThrow(/PERMISSION_DENIED/);
});
