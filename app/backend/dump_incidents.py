"""
dump_incidents.py — pull incident documents (and their append-only audit event_log) out of
Cosmos for inspection. Reuses the azd environment + Azure Developer CLI credential, exactly
like prepdocs.py, so there's no separate auth/config to wire up.

Run from app/backend with the backend venv:

    # all incidents -> incidents_dump.json
    ../../.venv/bin/python dump_incidents.py

    # one incident: pretty-prints its audit event log to the console AND writes the JSON
    ../../.venv/bin/python dump_incidents.py incident-20260617-xxxx

Requires `azd auth login` (you're already authenticated from deploying).
"""

import asyncio
import json
import os
import sys

from azure.cosmos.aio import CosmosClient
from azure.identity.aio import AzureDeveloperCliCredential

from load_azd_env import load_azd_env


async def main() -> None:
    load_azd_env()
    account = os.environ["AZURE_COSMOSDB_ACCOUNT"]
    database = os.environ["AZURE_CHAT_HISTORY_DATABASE"]
    container_name = os.getenv("AZURE_INCIDENTS_CONTAINER", "incidents")
    incident_id = sys.argv[1] if len(sys.argv) > 1 else None

    credential = AzureDeveloperCliCredential()
    async with CosmosClient(f"https://{account}.documents.azure.com:443/", credential=credential) as client:
        container = client.get_database_client(database).get_container_client(container_name)
        if incident_id:
            query = "SELECT * FROM c WHERE c.id = @id"
            params: list = [{"name": "@id", "value": incident_id}]
        else:
            query = "SELECT * FROM c"
            params = []
        docs = [d async for d in container.query_items(query=query, parameters=params)]
    await credential.close()

    # Pretty-print the audit trail for a single requested incident.
    if incident_id and docs:
        doc = docs[0]
        print(
            f"# Incident {doc['id']}  phase={doc.get('phase')}  "
            f"commandTransferredAt={doc.get('commandTransferredAt')}  lockedAt={doc.get('lockedAt')}"
        )
        for ev in doc.get("eventLog", []):
            actor = ev.get("actor")
            actor_s = actor if isinstance(actor, str) else (actor or {}).get("role", "?")
            print(f"  {ev.get('timestamp')}  {ev.get('type'):34}  {actor_s:22}  {json.dumps(ev.get('payload', {}))}")

    out = "incidents_dump.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(docs, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {len(docs)} incident doc(s) to {out}")


if __name__ == "__main__":
    asyncio.run(main())
