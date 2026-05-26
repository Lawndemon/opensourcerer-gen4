import dataclasses
import io
import json
import logging
import mimetypes
import os
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from pathlib import Path
from typing import Any, cast

from azure.cognitiveservices.speech import (
    ResultReason,
    SpeechConfig,
    SpeechSynthesisOutputFormat,
    SpeechSynthesisResult,
    SpeechSynthesizer,
)
from azure.identity.aio import (
    AzureDeveloperCliCredential,
    ManagedIdentityCredential,
    get_bearer_token_provider,
)
from azure.search.documents.aio import SearchClient
from azure.search.documents.indexes.aio import SearchIndexClient
from azure.search.documents.knowledgebases.aio import KnowledgeBaseRetrievalClient
from quart import (
    Blueprint,
    Quart,
    abort,
    current_app,
    jsonify,
    make_response,
    request,
    send_file,
    send_from_directory,
)
from quart_cors import cors

from approaches.approach import Approach, DataPoints
from approaches.chatreadretrieveread import ChatReadRetrieveReadApproach
from approaches.promptmanager import PromptManager
from approaches.validate_iap import ValidateIAPApproach
from approaches.refine_condition import RefineConditionApproach
from approaches.recommend_actions import RecommendActionsApproach
from approaches.extract_forms import ExtractFormsApproach
from models.incidents import (
    Actor,
    AddCustomRecommendationRequest,
    ApplyRefinementRequest,
    ApplyRefinementResponse,
    CloseIncidentRequest,
    CreateIncidentRequest,
    DismissRecommendationRequest,
    ExtractFormsRequest,
    ExtractFormsResponse,
    GetRecommendationsResponse,
    IncidentDocument,
    LossStopRequest,
    PublishRecommendationRequest,
    RefineConditionResponse,
    AttestContributionRequest,
    AutoPopulateRecommendationsRequest,
    RefreshRecommendationsRequest,
    RemoveConditionRequest,
    SetSceneTypeRequest,
    SceneSummary,
    TranscriptChunk,
    ValidateIAPRequest,
)
from pydantic import ValidationError
from chat_history.cosmosdb import chat_history_cosmosdb_bp
from incidents import cosmosdb as incidents_cosmos
from config import (
    CONFIG_AGENTIC_KNOWLEDGEBASE_ENABLED,
    CONFIG_AUTH_CLIENT,
    CONFIG_CHAT_APPROACH,
    CONFIG_VALIDATE_IAP_APPROACH,
    CONFIG_REFINE_CONDITION_APPROACH,
    CONFIG_RECOMMEND_ACTIONS_APPROACH,
    CONFIG_EXTRACT_FORMS_APPROACH,
    CONFIG_CHAT_HISTORY_BROWSER_ENABLED,
    CONFIG_CHAT_HISTORY_COSMOS_ENABLED,
    CONFIG_INCIDENTS_COSMOS_ENABLED,
    CONFIG_CREDENTIAL,
    CONFIG_DEFAULT_REASONING_EFFORT,
    CONFIG_DEFAULT_RETRIEVAL_REASONING_EFFORT,
    CONFIG_GLOBAL_BLOB_MANAGER,
    CONFIG_INGESTER,
    CONFIG_KNOWLEDGEBASE_CLIENT,
    CONFIG_KNOWLEDGEBASE_CLIENT_WITH_SHAREPOINT,
    CONFIG_KNOWLEDGEBASE_CLIENT_WITH_WEB,
    CONFIG_KNOWLEDGEBASE_CLIENT_WITH_WEB_AND_SHAREPOINT,
    CONFIG_LANGUAGE_PICKER_ENABLED,
    CONFIG_MULTIMODAL_ENABLED,
    CONFIG_OPENAI_CLIENT,
    CONFIG_QUERY_REWRITING_ENABLED,
    CONFIG_RAG_SEARCH_IMAGE_EMBEDDINGS,
    CONFIG_RAG_SEARCH_TEXT_EMBEDDINGS,
    CONFIG_RAG_SEND_IMAGE_SOURCES,
    CONFIG_RAG_SEND_TEXT_SOURCES,
    CONFIG_REASONING_EFFORT_ENABLED,
    CONFIG_SEARCH_CLIENT,
    CONFIG_SEMANTIC_RANKER_DEPLOYED,
    CONFIG_SHAREPOINT_SOURCE_ENABLED,
    CONFIG_SPEECH_INPUT_ENABLED,
    CONFIG_SPEECH_OUTPUT_AZURE_ENABLED,
    CONFIG_SPEECH_OUTPUT_BROWSER_ENABLED,
    CONFIG_SPEECH_SERVICE_ID,
    CONFIG_SPEECH_SERVICE_LOCATION,
    CONFIG_SPEECH_SERVICE_TOKEN,
    CONFIG_SPEECH_SERVICE_VOICE,
    CONFIG_STREAMING_ENABLED,
    CONFIG_USER_BLOB_MANAGER,
    CONFIG_USER_UPLOAD_ENABLED,
    CONFIG_VECTOR_SEARCH_ENABLED,
    CONFIG_WEB_SOURCE_ENABLED,
)
from core.authentication import AuthenticationHelper
from core.sessionhelper import create_session_id
from decorators import authenticated, authenticated_path
from error import error_dict, error_response
from prepdocs import (
    OpenAIHost,
    setup_embeddings_service,
    setup_file_processors,
    setup_image_embeddings_service,
    setup_openai_client,
    setup_search_info,
)
from prepdocslib.blobmanager import AdlsBlobManager, BlobManager
from prepdocslib.embeddings import ImageEmbeddings
from prepdocslib.filestrategy import UploadUserFileStrategy
from prepdocslib.listfilestrategy import File

bp = Blueprint("routes", __name__, static_folder="static")
# Fix Windows registry issue with mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")


@bp.route("/")
async def index():
    return await bp.send_static_file("index.html")


# Empty page is recommended for login redirect to work.
# See https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/initialization.md#redirecturi-considerations for more information
@bp.route("/redirect")
async def redirect():
    return ""


@bp.route("/favicon.ico")
async def favicon():
    return await bp.send_static_file("favicon.ico")


@bp.route("/assets/<path:path>")
async def assets(path):
    return await send_from_directory(Path(__file__).resolve().parent / "static" / "assets", path)


@bp.route("/content/<path>")
@authenticated_path
async def content_file(path: str, auth_claims: dict[str, Any]):
    """
    Serve content files from blob storage from within the app to keep the example self-contained.
    *** NOTE *** if you are using app services authentication, this route will return unauthorized to all users that are not logged in
    if AZURE_ENFORCE_ACCESS_CONTROL is not set or false, logged in users can access all files regardless of access control
    if AZURE_ENFORCE_ACCESS_CONTROL is set to true, logged in users can only access files they have access to
    This is also slow and memory hungry.
    """
    # Remove page number from path, filename-1.txt -> filename.txt
    # This shouldn't typically be necessary as browsers don't send hash fragments to servers
    if path.find("#page=") > 0:
        path_parts = path.rsplit("#page=", 1)
        path = path_parts[0]
    current_app.logger.info("Opening file %s", path)
    blob_manager: BlobManager = current_app.config[CONFIG_GLOBAL_BLOB_MANAGER]

    # Get bytes and properties from the blob manager
    result = await blob_manager.download_blob(path)

    if result is None:
        current_app.logger.info("Path not found in general Blob container: %s", path)
        if current_app.config[CONFIG_USER_UPLOAD_ENABLED]:
            user_oid = auth_claims["oid"]
            user_blob_manager: AdlsBlobManager = current_app.config[CONFIG_USER_BLOB_MANAGER]
            result = await user_blob_manager.download_blob(path, user_oid=user_oid)
            if result is None:
                current_app.logger.exception("Path not found in DataLake: %s", path)

    if not result:
        abort(404)

    content, properties = result

    if not properties or "content_settings" not in properties:
        abort(404)

    mime_type = properties["content_settings"]["content_type"]
    if mime_type == "application/octet-stream":
        mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    # Create a BytesIO object from the bytes
    blob_file = io.BytesIO(content)
    return await send_file(blob_file, mimetype=mime_type, as_attachment=False, attachment_filename=path)


class JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if dataclasses.is_dataclass(o) and not isinstance(o, type):
            as_dict = dataclasses.asdict(o)
            if isinstance(o, DataPoints):
                # Drop optional data point collections that are not populated to keep API surface stable
                return {k: v for k, v in as_dict.items() if v is not None}
            data_points_payload = as_dict.get("data_points") if isinstance(as_dict, dict) else None
            if isinstance(data_points_payload, dict) and data_points_payload.get("citation_activity_details") is None:
                data_points_payload.pop("citation_activity_details")
            return as_dict
        return super().default(o)


async def format_as_ndjson(r: AsyncGenerator[dict, None]) -> AsyncGenerator[str, None]:
    try:
        async for event in r:
            yield json.dumps(event, ensure_ascii=False, cls=JSONEncoder) + "\n"
    except Exception as error:
        logging.exception("Exception while generating response stream: %s", error)
        yield json.dumps(error_dict(error))


@bp.route("/chat", methods=["POST"])
@authenticated
async def chat(auth_claims: dict[str, Any]):
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    request_json = await request.get_json()
    context = request_json.get("context", {})
    context["auth_claims"] = auth_claims
    try:
        approach: Approach = cast(Approach, current_app.config[CONFIG_CHAT_APPROACH])

        # If session state is provided, persists the session state,
        # else creates a new session_id depending on the chat history options enabled.
        session_state = request_json.get("session_state")
        if session_state is None:
            session_state = create_session_id(
                current_app.config[CONFIG_CHAT_HISTORY_COSMOS_ENABLED],
                current_app.config[CONFIG_CHAT_HISTORY_BROWSER_ENABLED],
            )
        result = await approach.run(
            request_json["messages"],
            context=context,
            session_state=session_state,
        )
        return jsonify(result)
    except Exception as error:
        return error_response(error, "/chat")


@bp.route("/chat/stream", methods=["POST"])
@authenticated
async def chat_stream(auth_claims: dict[str, Any]):
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    request_json = await request.get_json()
    context = request_json.get("context", {})
    context["auth_claims"] = auth_claims
    try:
        approach: Approach = cast(Approach, current_app.config[CONFIG_CHAT_APPROACH])

        # If session state is provided, persists the session state,
        # else creates a new session_id depending on the chat history options enabled.
        session_state = request_json.get("session_state")
        if session_state is None:
            session_state = create_session_id(
                current_app.config[CONFIG_CHAT_HISTORY_COSMOS_ENABLED],
                current_app.config[CONFIG_CHAT_HISTORY_BROWSER_ENABLED],
            )
        result = await approach.run_stream(
            request_json["messages"],
            context=context,
            session_state=session_state,
        )
        response = await make_response(format_as_ndjson(result))
        response.timeout = None  # type: ignore
        response.mimetype = "application/json-lines"
        return response
    except Exception as error:
        return error_response(error, "/chat")


# --- Helpers for incident endpoints --------------------------------------------
#
# Every incident-mutating endpoint records an audit event with WHO did it (acting role +
# user id). These helpers centralize the extraction so callsites stay readable.


def _actor_from(auth_claims: dict[str, Any], acting_role: str, user_id_override: str | None = None) -> Actor:
    """Build an Actor from auth claims plus the request's acting_role.

    `user_id` falls back to the Entra OID. The optional override exists for the case where
    the frontend explicitly passes its idea of user_id — useful when local-dev mode has no
    auth_claims available.
    """
    user_id = user_id_override or auth_claims.get("oid") or "unknown"
    return Actor(role=acting_role, user_id=user_id)


def _tenant_id_from(auth_claims: dict[str, Any], override: str | None = None) -> str:
    """Tenant id used for Cosmos partitioning.

    For v1 we prefer an explicit override (when one is supplied) → the auth `tid` claim →
    `"default"`. When multi-tenant deployment becomes the only mode, the override path
    should be removed so the `tid` claim is the only source of truth.
    """
    return override or auth_claims.get("tid") or "default"


def _incidents_enabled_or_503():
    """Returns a Quart response if Cosmos persistence is off; otherwise None."""
    if not current_app.config.get(CONFIG_INCIDENTS_COSMOS_ENABLED):
        return (
            jsonify({"error": "Incidents persistence is not enabled on this deployment."}),
            503,
        )
    return None


# --- Fire Officer kiosk: Validate IAP -------------------------------------------
#
# Takes the accumulated transcript, returns structured Scene Summary + Scene Conditions and
# Actions + per-role forms. When Cosmos persistence is enabled AND an incident record exists
# for the given id, the result is reconciled with the persisted state (sticky-by-default
# for previously-removed conditions) and an audit event is appended.
#
# When persistence is disabled, or the incident doesn't exist in Cosmos yet, the endpoint
# falls back to its Session 1 behavior: pure LLM extraction, no state preserved between
# calls. This keeps the legacy fixture-driven demo flow working without a Cosmos account.
@bp.route("/api/incidents/<incident_id>/validate-iap", methods=["POST"])
@authenticated
async def validate_iap(auth_claims: dict[str, Any], incident_id: str):
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415

    request_json = await request.get_json()

    # The path-param incident_id is authoritative; require the body's incidentId to match (or be
    # absent — frontend may omit if the URL is the source of truth).
    body_incident_id = request_json.get("incidentId") or request_json.get("incident_id")
    if body_incident_id and body_incident_id != incident_id:
        return jsonify({
            "error": "incidentId in request body does not match URL path",
            "url_incident_id": incident_id,
            "body_incident_id": body_incident_id,
        }), 400
    request_json["incidentId"] = incident_id

    try:
        validate_request = ValidateIAPRequest.model_validate(request_json)
    except ValidationError as ve:
        return jsonify({"error": "request body did not match the ValidateIAPRequest contract", "details": ve.errors()}), 400

    try:
        # Scene-only extraction (5d.1). Forms are generated separately by the decoupled
        # extract-forms endpoint so the kiosk never blocks on form generation.
        approach: ValidateIAPApproach = cast(
            ValidateIAPApproach, current_app.config[CONFIG_VALIDATE_IAP_APPROACH]
        )
        result = await approach.run(validate_request)

        # Persist reconciliation if Cosmos is enabled and an incident record exists.
        # We intentionally only attempt reconciliation when the incident is already
        # persisted — first-call Validate IAP for an unpersisted incident still works
        # without Cosmos (Session 1 compatibility for the deployed demo path).
        if current_app.config.get(CONFIG_INCIDENTS_COSMOS_ENABLED):
            tenant_id = _tenant_id_from(auth_claims)
            existing = await incidents_cosmos.get_incident(tenant_id, incident_id)
            if existing is not None:
                persisted = await incidents_cosmos.apply_validate_iap_result(
                    tenant_id=tenant_id,
                    incident_id=incident_id,
                    new_scene_summary=result.scene_summary,
                    new_conditions=result.scene_conditions_and_actions,
                )
                # Return the reconciled result (removed-flag stickiness already applied).
                return jsonify({
                    "incidentId": persisted.id,
                    "phase": persisted.phase,
                    "sceneSummary": persisted.scene_summary.model_dump(by_alias=True),
                    "sceneConditionsAndActions": [
                        c.model_dump(by_alias=True) for c in persisted.scene_conditions_and_actions
                    ],
                    "supportContributions": [
                        s.model_dump(by_alias=True) for s in persisted.support_contributions
                    ],
                    "forms": [f.model_dump(by_alias=True) for f in persisted.forms],
                })

        # Fall-through: Session-1 behavior, no persistence.
        return jsonify(result.model_dump(by_alias=True))
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/validate-iap")


# --- Fire Officer kiosk: Extract Forms (decoupled, 5d.1) ------------------------
#
# Runs the downstream forms extraction OFF the critical path. The kiosk renders the scene
# dashboard the moment Validate IAP returns, then fires this endpoint in the background;
# the 27 role-tagged forms populate when it resolves. Keeping forms off the Validate IAP
# response is what guarantees the Fire Officer's screen is never locked by form generation.
#
# Scene source: when the incident is persisted, the authoritative scene state is read from
# Cosmos (post-reconciliation). For the ephemeral demo path (Cosmos off / incident not
# persisted), the scene state is taken from the request body.
@bp.route("/api/incidents/<incident_id>/extract-forms", methods=["POST"])
@authenticated
async def extract_forms(auth_claims: dict[str, Any], incident_id: str):
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = ExtractFormsRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match ExtractFormsRequest", "details": ve.errors()}), 400

    try:
        # Resolve the scene state the forms will be generated from.
        persisted_doc = None
        tenant_id = None
        if current_app.config.get(CONFIG_INCIDENTS_COSMOS_ENABLED):
            tenant_id = _tenant_id_from(auth_claims)
            persisted_doc = await incidents_cosmos.get_incident(tenant_id, incident_id)

        if persisted_doc is not None:
            scene_summary = persisted_doc.scene_summary
            scene_conditions = persisted_doc.scene_conditions_and_actions
        else:
            # Ephemeral path — the scene state must come from the request body.
            if body.scene_summary is None:
                return jsonify({
                    "error": "scene_summary and scene_conditions_and_actions are required for an unpersisted incident"
                }), 400
            scene_summary = body.scene_summary
            scene_conditions = body.scene_conditions_and_actions

        # Transcript resolution (5e): prefer the body transcript (kiosk passes the fixture);
        # otherwise derive it from the persisted incident's chunks so the support-role
        # "Update forms" path generates from the same source the kiosk used. Falls back to
        # scene-state-only when neither is available.
        transcript_text = body.transcript
        if not transcript_text and persisted_doc is not None and persisted_doc.transcript:
            transcript_text = "\n".join(
                ch.de_noised or ch.text for ch in persisted_doc.transcript
            )

        forms_approach: ExtractFormsApproach = cast(
            ExtractFormsApproach, current_app.config[CONFIG_EXTRACT_FORMS_APPROACH]
        )
        forms = await forms_approach.run(
            incident_id=incident_id,
            transcript=transcript_text,
            scene_summary=scene_summary,
            scene_conditions_and_actions=scene_conditions,
        )

        # Persist when the incident is a real Cosmos record; ephemeral incidents just get
        # the forms back in the response and hold them in frontend state.
        if persisted_doc is not None and tenant_id is not None:
            actor = _actor_from(auth_claims, body.acting_role)
            await incidents_cosmos.apply_extracted_forms(
                tenant_id=tenant_id,
                incident_id=incident_id,
                new_forms=forms,
                actor=actor,
            )

        return jsonify(ExtractFormsResponse(forms=forms).model_dump(by_alias=True))
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/extract-forms")


# --- Incident lifecycle endpoints (Session 3) -----------------------------------
#
# All three require Cosmos persistence to be enabled. Each one writes both the state change
# AND an audit event in a single document replace — see incidents/cosmosdb.py for the
# enforced pattern.


@bp.route("/api/incidents", methods=["POST"])
@authenticated
async def create_incident(auth_claims: dict[str, Any]):
    """Create a new incident.

    Body: `CreateIncidentRequest` (actingRole, optional transcript, optional tenantId).
    Returns the full persisted incident. If `transcript` is supplied, Validate IAP runs
    against it inline so the kiosk can render the dashboard without a second round-trip.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = CreateIncidentRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match CreateIncidentRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role)
    tenant_id = _tenant_id_from(auth_claims, body.tenant_id)
    incident_id = f"incident-{int(time.time() * 1000)}-{os.urandom(2).hex()}"
    now = incidents_cosmos._now_iso()

    # Persist the opening transcript (5e) so any later forms regeneration — by the kiosk OR
    # by a support role's "Update forms" — works from the same source and can't degrade the
    # forms. Prototype simplification: the transcript is a fixture, stored as a single chunk.
    # Real append-only-from-mic STT chunks land post-demo; the immutability semantics apply
    # then. de_noised is null until the de-noising preprocessor exists.
    initial_transcript = (
        [TranscriptChunk(chunk_id="t-1", timestamp=now, text=body.transcript, de_noised=None)]
        if body.transcript
        else []
    )

    # Initial document — empty scene state, single phase_transitioned audit event recording
    # the incident's creation. If the kiosk supplied an opening transcript, Validate IAP
    # runs below and populates scene state.
    initial_doc = IncidentDocument(
        id=incident_id,
        tenant_id=tenant_id,
        phase="response",
        created_by=actor,
        created_at=now,
        transcript=initial_transcript,
        scene_summary=SceneSummary(text="", last_updated=now),
        event_log=[
            incidents_cosmos.make_audit_event(
                incident_id=incident_id,
                event_type="phase_transitioned",
                actor=actor,
                payload={"from": None, "to": "response", "trigger": "create_incident"},
            )
        ],
    )
    try:
        created = await incidents_cosmos.create_incident(initial_doc)

        # Optional inline Validate IAP if a transcript was supplied. Scene-only (5d.1) —
        # the kiosk fires the decoupled extract-forms call in the background once the
        # dashboard has rendered, so creation never waits on form generation.
        if body.transcript:
            approach: ValidateIAPApproach = cast(
                ValidateIAPApproach, current_app.config[CONFIG_VALIDATE_IAP_APPROACH]
            )
            iap_result = await approach.run(
                ValidateIAPRequest(
                    incident_id=incident_id,
                    transcript=body.transcript,
                    acting_role=body.acting_role,
                )
            )
            created = await incidents_cosmos.apply_validate_iap_result(
                tenant_id=tenant_id,
                incident_id=incident_id,
                new_scene_summary=iap_result.scene_summary,
                new_conditions=iap_result.scene_conditions_and_actions,
                new_scene_type_estimate=iap_result.scene_type_estimate,
            )
        return jsonify({"incident": created.model_dump(by_alias=True)}), 201
    except Exception as error:
        return error_response(error, "/api/incidents")


@bp.route("/api/incidents", methods=["GET"])
@authenticated
async def list_incidents(auth_claims: dict[str, Any]):
    """List incidents in the requesting user's tenant, newest first.

    Used by the IMT incident dashboard (Session 5). Returns the full IncidentDocument for
    each — for v1 prototype volumes this is fine and saves the frontend a second round-trip
    when an incident is opened. Future optimization: a summaries-only projection.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    tenant_id = _tenant_id_from(auth_claims, request.args.get("tenantId"))
    try:
        items = await incidents_cosmos.list_incidents(tenant_id)
        return jsonify({"incidents": [item.model_dump(by_alias=True) for item in items]})
    except Exception as error:
        return error_response(error, "/api/incidents")


@bp.route("/api/incidents/<incident_id>", methods=["GET"])
@authenticated
async def get_incident(auth_claims: dict[str, Any], incident_id: str):
    """Read a single incident. Used to rehydrate kiosk state on refresh."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    try:
        tenant_id = _tenant_id_from(auth_claims, request.args.get("tenantId"))
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404
        return jsonify({"incident": doc.model_dump(by_alias=True)})
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}")


@bp.route("/api/incidents/<incident_id>/loss-stop", methods=["POST"])
@authenticated
async def loss_stop(auth_claims: dict[str, Any], incident_id: str):
    """Loss Stop: Response → Transition to Recovery. Locks active forms. Audit-logged."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = LossStopRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match LossStopRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated = await incidents_cosmos.transition_to_loss_stopped(
            tenant_id=tenant_id, incident_id=incident_id, actor=actor
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/loss-stop")


@bp.route("/api/incidents/<incident_id>/scene-type", methods=["POST"])
@authenticated
async def set_scene_type(auth_claims: dict[str, Any], incident_id: str):
    """Confirm or change the incident's ICS scene Type (1–5). Append-only, audit-logged.

    The Fire Officer confirms the AI-estimated Type or changes it as the scene escalates.
    Each change appends a `scene_type_confirmed` event; `confirm_scene_type` is idempotent on
    a no-op re-confirm (double-tapping the same circle won't duplicate events).

    TODO (slice 4 — see BACKLOG.md "Auto-populate support recommendations on scene-type
    confirm"): on a confirm/change, re-trigger the downstream jobs OFF THE CRITICAL PATH —
    support-recommendation auto-population AND forms population — mirroring the initial
    confirm. IAP validation is intentionally NOT triggered here (stays manual via Re-Validate).
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = SetSceneTypeRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match SetSceneTypeRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated = await incidents_cosmos.confirm_scene_type(
            tenant_id=tenant_id, incident_id=incident_id, new_type=body.scene_type, actor=actor
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/scene-type")


@bp.route("/api/incidents/<incident_id>/support-contributions/<contribution_id>/attest", methods=["POST"])
@authenticated
async def attest_contribution(auth_claims: dict[str, Any], incident_id: str, contribution_id: str):
    """Confirm an AI-suggested support contribution — flips its provenance AI -> HIC.

    The named human in the support role takes ownership of the recommendation. Append-only,
    audit-logged (`support_recommendation_attested`). Idempotent on an already-HIC item.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = AttestContributionRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match AttestContributionRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated = await incidents_cosmos.attest_support_contribution(
            tenant_id=tenant_id, incident_id=incident_id, contribution_id=contribution_id, actor=actor
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/support-contributions/{contribution_id}/attest")


# Support roles auto-populated on scene-type confirm (slice E): the eight ICS IMT roles.
# Excludes fire-officer (the kiosk operator) and site-administrator (not an on-scene support role).
_AUTO_POPULATE_ROLES = [
    "incident-commander",
    "safety-officer",
    "liaison-officer",
    "information-officer",
    "section-chief-operations",
    "section-chief-planning",
    "section-chief-logistics",
    "section-chief-finance",
]


@bp.route("/api/incidents/<incident_id>/auto-populate-recommendations", methods=["POST"])
@authenticated
async def auto_populate_recommendations(auth_claims: dict[str, Any], incident_id: str):
    """Generate recommendations for ALL support roles and surface them on the FO pane tagged AI.

    Fired in the background by the kiosk after the Fire Officer confirms (or changes) the scene
    Type — never on the critical path. Regenerates the AI set, preserving items a human already
    confirmed to HIC (re-fire behavior pending SME final confirmation). Loops roles sequentially
    for v1; can be parallelized later if latency matters.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = AutoPopulateRecommendationsRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match AutoPopulateRecommendationsRequest", "details": ve.errors()}), 400

    _ = body  # actor identity not needed downstream; generated items are tagged per support role.
    tenant_id = _tenant_id_from(auth_claims)
    try:
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404
        approach: RecommendActionsApproach = cast(
            RecommendActionsApproach, current_app.config[CONFIG_RECOMMEND_ACTIONS_APPROACH]
        )
        scene_summary_text = doc.scene_summary.text if doc.scene_summary else ""
        # Don't re-suggest what a human already owns (HIC) — pass those as already-published.
        already_hic = [c for c in doc.support_contributions if c.provenance == "hic"]
        role_items: list[tuple[str, str, Any]] = []
        for role in _AUTO_POPULATE_ROLES:
            recently_dismissed = incidents_cosmos.get_recent_dismissed_texts(doc, role)
            items = await approach.run(
                role=role,
                scene_summary_text=scene_summary_text,
                scene_conditions=doc.scene_conditions_and_actions,
                scene_type=doc.scene_type,
                scene_type_estimate=doc.scene_type_estimate,
                already_published=already_hic,
                recently_dismissed=recently_dismissed,
            )
            role_items.extend((role, it.text, it.category) for it in items)
        updated = await incidents_cosmos.apply_auto_populated_ai_contributions(
            tenant_id=tenant_id, incident_id=incident_id, role_items=role_items
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/auto-populate-recommendations")


# Roles permitted to close an incident (decision 2026-05-20; Incident Commander added
# 2026-05-21). Incident Commander is the command-authority closer (owns the incident);
# Safety Officer is the operational closer; Site Administrator keeps a broad override.
_CLOSE_INCIDENT_ROLES = {"incident-commander", "safety-officer", "site-administrator"}


@bp.route("/api/incidents/<incident_id>/close", methods=["POST"])
@authenticated
async def close_incident(auth_claims: dict[str, Any], incident_id: str):
    """Close an incident: Transition to Recovery → Recovery (terminal). Audit-logged.

    Authorized for the Safety Officer and Site Administrator only, and only from the
    Transition to Recovery phase. Closing drops the incident from the support-role list
    (recovery phase is excluded); the record persists per the immutability principle.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = CloseIncidentRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match CloseIncidentRequest", "details": ve.errors()}), 400

    if body.acting_role not in _CLOSE_INCIDENT_ROLES:
        return jsonify({
            "error": "Only the Safety Officer or Site Administrator can close an incident.",
            "actingRole": body.acting_role,
        }), 403

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated = await incidents_cosmos.close_incident(
            tenant_id=tenant_id, incident_id=incident_id, actor=actor
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        # Phase precondition failures ("must be in transition_to_recovery") and not-found
        # both raise ValueError; distinguish so the client can react appropriately.
        message = str(ve)
        status = 404 if "not found" in message.lower() else 409
        return jsonify({"error": message}), status
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/close")


@bp.route("/api/incidents/<incident_id>/conditions/<condition_id>", methods=["DELETE"])
@authenticated
async def remove_condition(auth_claims: dict[str, Any], incident_id: str, condition_id: str):
    """Mark a Scene Condition or Action as removed by the Fire Officer.

    Per immutability principle this is a flag flip, not a hard delete. Sticky-by-default;
    new transcript evidence on a subsequent Validate IAP may resurface it via the
    extraction prompt minting a fresh id.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = RemoveConditionRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match RemoveConditionRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated = await incidents_cosmos.remove_condition(
            tenant_id=tenant_id,
            incident_id=incident_id,
            condition_id=condition_id,
            actor=actor,
        )
        return jsonify({"incident": updated.model_dump(by_alias=True)})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/conditions/{condition_id}")


# --- Refine Condition endpoint pair (Session 4) --------------------------------
#
# Two-step UX: (1) GET the 3 narrowing statements from the LLM, (2) POST a selection
# that the LLM re-evaluates and we persist with an audit event. Both require Cosmos
# persistence to be enabled — the kiosk has no useful fallback for refine when there's
# no persisted condition to refine against.


@bp.route("/api/incidents/<incident_id>/conditions/<condition_id>/refine", methods=["POST"])
@authenticated
async def refine_condition(auth_claims: dict[str, Any], incident_id: str, condition_id: str):
    """Return three LLM-generated narrowing statements for the Fire Officer to pick from."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    tenant_id = _tenant_id_from(auth_claims)
    try:
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404
        condition = next((c for c in doc.scene_conditions_and_actions if c.id == condition_id), None)
        if condition is None:
            return jsonify({"error": f"Condition not found: {condition_id}"}), 404
        if condition.removed:
            return jsonify({"error": "Cannot refine a removed condition"}), 409

        # Reconstruct a transcript string from the persisted TranscriptChunk list. For v1
        # this is empty in most cases (we don't yet write chunks); the LLM falls back to
        # the condition's own text + plan context. Once streaming STT lands, the chunks
        # will carry the live radio chatter.
        transcript_text = "\n".join(
            ch.de_noised or ch.text for ch in doc.transcript
        ) if doc.transcript else ""

        approach: RefineConditionApproach = cast(
            RefineConditionApproach, current_app.config[CONFIG_REFINE_CONDITION_APPROACH]
        )
        statements = await approach.generate_narrowing_statements(
            condition=condition, transcript=transcript_text
        )
        response = RefineConditionResponse(
            condition_id=condition_id, narrowing_statements=statements
        )
        return jsonify(response.model_dump(by_alias=True))
    except Exception as error:
        return error_response(error, f"/api/incidents/{incident_id}/conditions/{condition_id}/refine")


@bp.route("/api/incidents/<incident_id>/conditions/<condition_id>/refine/apply", methods=["POST"])
@authenticated
async def apply_refinement_endpoint(auth_claims: dict[str, Any], incident_id: str, condition_id: str):
    """Apply a Fire Officer's selection and persist the re-evaluated condition.

    `selected_statement=None` represents "None of the above" — the Fire Officer declined
    all suggestions. We still record the audit event so the decision is in the immutable log.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = ApplyRefinementRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({"error": "request body did not match ApplyRefinementRequest", "details": ve.errors()}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404
        condition = next((c for c in doc.scene_conditions_and_actions if c.id == condition_id), None)
        if condition is None:
            return jsonify({"error": f"Condition not found: {condition_id}"}), 404

        transcript_text = "\n".join(
            ch.de_noised or ch.text for ch in doc.transcript
        ) if doc.transcript else ""

        approach: RefineConditionApproach = cast(
            RefineConditionApproach, current_app.config[CONFIG_REFINE_CONDITION_APPROACH]
        )
        new_status, new_context, delta_note = await approach.apply_refinement(
            condition=condition,
            transcript=transcript_text,
            selected_statement=body.selected_statement,
        )

        updated_doc = await incidents_cosmos.apply_refinement(
            tenant_id=tenant_id,
            incident_id=incident_id,
            condition_id=condition_id,
            selected_statement=body.selected_statement,
            new_status=new_status,
            new_published_plan_context=new_context,
            delta_note=delta_note,
            actor=actor,
        )
        updated_condition = next(
            (c for c in updated_doc.scene_conditions_and_actions if c.id == condition_id), None
        )
        if updated_condition is None:
            return jsonify({"error": "Updated condition missing from document"}), 500
        response = ApplyRefinementResponse(updated_condition=updated_condition)
        return jsonify(response.model_dump(by_alias=True))
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(
            error, f"/api/incidents/{incident_id}/conditions/{condition_id}/refine/apply"
        )


# --- Support-role recommendations endpoints (Session 5b) -----------------------
#
# Each support role gets their own pending list per incident. Refresh regenerates from
# the current scene + already-published + recently-dismissed context. Publish moves a
# pending item onto the incident's support_contributions (visible to the Fire Officer).
# Dismiss removes it from pending and writes a dismissal audit event.


def _find_role_recommendations(doc: IncidentDocument, role: str):
    """Return the RoleRecommendations entry for `role` or None."""
    return next((rr for rr in doc.role_recommendations if rr.role == role), None)


@bp.route("/api/incidents/<incident_id>/support-recommendations", methods=["GET"])
@authenticated
async def get_support_recommendations(auth_claims: dict[str, Any], incident_id: str):
    """Read the requesting role's pending recommendations list.

    Used by the support-role page on open. Returns an empty list (with
    `last_generated_at=None`) if the role hasn't refreshed yet — the frontend then
    auto-fires a Refresh on mount to get an initial set.
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    role = request.args.get("role")
    if not role:
        return jsonify({"error": "?role= query parameter required"}), 400
    tenant_id = _tenant_id_from(auth_claims)
    try:
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404
        entry = _find_role_recommendations(doc, role)
        response = GetRecommendationsResponse(
            role=role,
            items=entry.items if entry else [],
            last_generated_at=entry.last_generated_at if entry else None,
            scene_last_updated=doc.scene_summary.last_updated if doc.scene_summary else None,
        )
        return jsonify(response.model_dump(by_alias=True))
    except Exception as error:
        return error_response(
            error, f"/api/incidents/{incident_id}/support-recommendations"
        )


@bp.route("/api/incidents/<incident_id>/support-recommendations/refresh", methods=["POST"])
@authenticated
async def refresh_support_recommendations(auth_claims: dict[str, Any], incident_id: str):
    """Regenerate the role's pending list via the LLM."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = RefreshRecommendationsRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({
            "error": "request body did not match RefreshRecommendationsRequest",
            "details": ve.errors(),
        }), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        doc = await incidents_cosmos.get_incident(tenant_id, incident_id)
        if doc is None:
            return jsonify({"error": f"Incident not found: {incident_id}"}), 404

        recently_dismissed = incidents_cosmos.get_recent_dismissed_texts(doc, body.acting_role)
        approach: RecommendActionsApproach = cast(
            RecommendActionsApproach, current_app.config[CONFIG_RECOMMEND_ACTIONS_APPROACH]
        )
        new_items = await approach.run(
            role=body.acting_role,
            scene_summary_text=doc.scene_summary.text if doc.scene_summary else "",
            scene_conditions=doc.scene_conditions_and_actions,
            scene_type=doc.scene_type,
            scene_type_estimate=doc.scene_type_estimate,
            already_published=doc.support_contributions,
            recently_dismissed=recently_dismissed,
        )
        updated_doc = await incidents_cosmos.refresh_role_recommendations(
            tenant_id=tenant_id,
            incident_id=incident_id,
            role=body.acting_role,
            new_items_with_category=[(it.text, it.category) for it in new_items],
            actor=actor,
        )
        entry = _find_role_recommendations(updated_doc, body.acting_role)
        response = GetRecommendationsResponse(
            role=body.acting_role,
            items=entry.items if entry else [],
            last_generated_at=entry.last_generated_at if entry else None,
            scene_last_updated=updated_doc.scene_summary.last_updated if updated_doc.scene_summary else None,
        )
        return jsonify(response.model_dump(by_alias=True))
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(
            error, f"/api/incidents/{incident_id}/support-recommendations/refresh"
        )


@bp.route(
    "/api/incidents/<incident_id>/support-recommendations/<recommendation_id>/publish",
    methods=["POST"],
)
@authenticated
async def publish_support_recommendation(
    auth_claims: dict[str, Any], incident_id: str, recommendation_id: str
):
    """Move a pending item onto the incident's support_contributions list."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = PublishRecommendationRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({
            "error": "request body did not match PublishRecommendationRequest",
            "details": ve.errors(),
        }), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated_doc = await incidents_cosmos.publish_recommendation(
            tenant_id=tenant_id,
            incident_id=incident_id,
            role=body.acting_role,
            recommendation_id=recommendation_id,
            actor=actor,
        )
        entry = _find_role_recommendations(updated_doc, body.acting_role)
        response = GetRecommendationsResponse(
            role=body.acting_role,
            items=entry.items if entry else [],
            last_generated_at=entry.last_generated_at if entry else None,
            scene_last_updated=updated_doc.scene_summary.last_updated if updated_doc.scene_summary else None,
        )
        return jsonify(response.model_dump(by_alias=True))
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(
            error,
            f"/api/incidents/{incident_id}/support-recommendations/{recommendation_id}/publish",
        )


@bp.route(
    "/api/incidents/<incident_id>/support-recommendations/<recommendation_id>/dismiss",
    methods=["POST"],
)
@authenticated
async def dismiss_support_recommendation(
    auth_claims: dict[str, Any], incident_id: str, recommendation_id: str
):
    """Remove a pending item; record a `support_recommendation_dismissed` audit event."""
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = DismissRecommendationRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({
            "error": "request body did not match DismissRecommendationRequest",
            "details": ve.errors(),
        }), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated_doc = await incidents_cosmos.dismiss_recommendation(
            tenant_id=tenant_id,
            incident_id=incident_id,
            role=body.acting_role,
            recommendation_id=recommendation_id,
            actor=actor,
        )
        entry = _find_role_recommendations(updated_doc, body.acting_role)
        response = GetRecommendationsResponse(
            role=body.acting_role,
            items=entry.items if entry else [],
            last_generated_at=entry.last_generated_at if entry else None,
            scene_last_updated=updated_doc.scene_summary.last_updated if updated_doc.scene_summary else None,
        )
        return jsonify(response.model_dump(by_alias=True))
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(
            error,
            f"/api/incidents/{incident_id}/support-recommendations/{recommendation_id}/dismiss",
        )


@bp.route("/api/incidents/<incident_id>/support-recommendations/custom", methods=["POST"])
@authenticated
async def add_custom_support_recommendation(auth_claims: dict[str, Any], incident_id: str):
    """Append a role-typed custom item to the pending list.

    Custom items still require an explicit publish step before they reach the Fire
    Officer's kiosk — matches the curation spec (every published item is deliberate).
    """
    if (disabled := _incidents_enabled_or_503()) is not None:
        return disabled
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    try:
        body = AddCustomRecommendationRequest.model_validate(await request.get_json())
    except ValidationError as ve:
        return jsonify({
            "error": "request body did not match AddCustomRecommendationRequest",
            "details": ve.errors(),
        }), 400

    if not body.text.strip():
        return jsonify({"error": "Custom recommendation text cannot be empty"}), 400

    actor = _actor_from(auth_claims, body.acting_role, body.user_id)
    tenant_id = _tenant_id_from(auth_claims)
    try:
        updated_doc = await incidents_cosmos.add_custom_recommendation(
            tenant_id=tenant_id,
            incident_id=incident_id,
            role=body.acting_role,
            text=body.text.strip(),
            actor=actor,
        )
        entry = _find_role_recommendations(updated_doc, body.acting_role)
        response = GetRecommendationsResponse(
            role=body.acting_role,
            items=entry.items if entry else [],
            last_generated_at=entry.last_generated_at if entry else None,
            scene_last_updated=updated_doc.scene_summary.last_updated if updated_doc.scene_summary else None,
        )
        return jsonify(response.model_dump(by_alias=True))
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 404
    except Exception as error:
        return error_response(
            error, f"/api/incidents/{incident_id}/support-recommendations/custom"
        )


# Send MSAL.js settings to the client UI
@bp.route("/auth_setup", methods=["GET"])
def auth_setup():
    auth_helper = current_app.config[CONFIG_AUTH_CLIENT]
    return jsonify(auth_helper.get_auth_setup_for_client())


@bp.route("/config", methods=["GET"])
def config():
    return jsonify(
        {
            "showMultimodalOptions": current_app.config[CONFIG_MULTIMODAL_ENABLED],
            "showSemanticRankerOption": current_app.config[CONFIG_SEMANTIC_RANKER_DEPLOYED],
            "showQueryRewritingOption": current_app.config[CONFIG_QUERY_REWRITING_ENABLED],
            "showReasoningEffortOption": current_app.config[CONFIG_REASONING_EFFORT_ENABLED],
            "streamingEnabled": current_app.config[CONFIG_STREAMING_ENABLED],
            "defaultReasoningEffort": current_app.config[CONFIG_DEFAULT_REASONING_EFFORT],
            "defaultRetrievalReasoningEffort": current_app.config[CONFIG_DEFAULT_RETRIEVAL_REASONING_EFFORT],
            "showVectorOption": current_app.config[CONFIG_VECTOR_SEARCH_ENABLED],
            "showUserUpload": current_app.config[CONFIG_USER_UPLOAD_ENABLED],
            "showLanguagePicker": current_app.config[CONFIG_LANGUAGE_PICKER_ENABLED],
            "showSpeechInput": current_app.config[CONFIG_SPEECH_INPUT_ENABLED],
            "showSpeechOutputBrowser": current_app.config[CONFIG_SPEECH_OUTPUT_BROWSER_ENABLED],
            "showSpeechOutputAzure": current_app.config[CONFIG_SPEECH_OUTPUT_AZURE_ENABLED],
            "showChatHistoryBrowser": current_app.config[CONFIG_CHAT_HISTORY_BROWSER_ENABLED],
            "showChatHistoryCosmos": current_app.config[CONFIG_CHAT_HISTORY_COSMOS_ENABLED],
            "showAgenticRetrievalOption": current_app.config[CONFIG_AGENTIC_KNOWLEDGEBASE_ENABLED],
            "ragSearchTextEmbeddings": current_app.config[CONFIG_RAG_SEARCH_TEXT_EMBEDDINGS],
            "ragSearchImageEmbeddings": current_app.config[CONFIG_RAG_SEARCH_IMAGE_EMBEDDINGS],
            "ragSendTextSources": current_app.config[CONFIG_RAG_SEND_TEXT_SOURCES],
            "ragSendImageSources": current_app.config[CONFIG_RAG_SEND_IMAGE_SOURCES],
            "webSourceEnabled": current_app.config[CONFIG_WEB_SOURCE_ENABLED],
            "sharepointSourceEnabled": current_app.config[CONFIG_SHAREPOINT_SOURCE_ENABLED],
        }
    )


@bp.route("/speech", methods=["POST"])
async def speech():
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415

    speech_token = current_app.config.get(CONFIG_SPEECH_SERVICE_TOKEN)
    if speech_token is None or speech_token.expires_on < time.time() + 60:
        speech_token = await current_app.config[CONFIG_CREDENTIAL].get_token(
            "https://cognitiveservices.azure.com/.default"
        )
        current_app.config[CONFIG_SPEECH_SERVICE_TOKEN] = speech_token

    request_json = await request.get_json()
    text = request_json["text"]
    try:
        # Construct a token as described in documentation:
        # https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth?pivots=programming-language-python
        auth_token = (
            "aad#"
            + current_app.config[CONFIG_SPEECH_SERVICE_ID]
            + "#"
            + current_app.config[CONFIG_SPEECH_SERVICE_TOKEN].token
        )
        speech_config = SpeechConfig(auth_token=auth_token, region=current_app.config[CONFIG_SPEECH_SERVICE_LOCATION])
        speech_config.speech_synthesis_voice_name = current_app.config[CONFIG_SPEECH_SERVICE_VOICE]
        speech_config.set_speech_synthesis_output_format(SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3)
        synthesizer = SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        result: SpeechSynthesisResult = synthesizer.speak_text_async(text).get()
        if result.reason == ResultReason.SynthesizingAudioCompleted:
            return result.audio_data, 200, {"Content-Type": "audio/mp3"}
        elif result.reason == ResultReason.Canceled:
            cancellation_details = result.cancellation_details
            current_app.logger.error(
                "Speech synthesis canceled: %s %s", cancellation_details.reason, cancellation_details.error_details
            )
            raise Exception("Speech synthesis canceled. Check logs for details.")
        else:
            current_app.logger.error("Unexpected result reason: %s", result.reason)
            raise Exception("Speech synthesis failed. Check logs for details.")
    except Exception as e:
        current_app.logger.exception("Exception in /speech")
        return jsonify({"error": str(e)}), 500


@bp.post("/upload")
@authenticated
async def upload(auth_claims: dict[str, Any]):
    request_files = await request.files
    if "file" not in request_files:
        return jsonify({"message": "No file part in the request", "status": "failed"}), 400

    try:
        user_oid = auth_claims["oid"]
        file = request_files.getlist("file")[0]
        adls_manager: AdlsBlobManager = current_app.config[CONFIG_USER_BLOB_MANAGER]
        file_url = await adls_manager.upload_blob(file, file.filename, user_oid)
        ingester: UploadUserFileStrategy = current_app.config[CONFIG_INGESTER]
        await ingester.add_file(File(content=file, url=file_url, acls={"oids": [user_oid]}), user_oid=user_oid)
        return jsonify({"message": "File uploaded successfully"}), 200
    except Exception as error:
        current_app.logger.error("Error uploading file: %s", error)
        return jsonify({"message": "Error uploading file, check server logs for details.", "status": "failed"}), 500


@bp.post("/delete_uploaded")
@authenticated
async def delete_uploaded(auth_claims: dict[str, Any]):
    request_json = await request.get_json()
    filename = request_json.get("filename")
    user_oid = auth_claims["oid"]
    adls_manager: AdlsBlobManager = current_app.config[CONFIG_USER_BLOB_MANAGER]
    await adls_manager.remove_blob(filename, user_oid)
    ingester: UploadUserFileStrategy = current_app.config[CONFIG_INGESTER]
    await ingester.remove_file(filename, user_oid)
    return jsonify({"message": f"File {filename} deleted successfully"}), 200


@bp.get("/list_uploaded")
@authenticated
async def list_uploaded(auth_claims: dict[str, Any]):
    """Lists the uploaded documents for the current user.
    Only returns files directly in the user's directory, not in subdirectories.
    Excludes image files and the images directory."""
    user_oid = auth_claims["oid"]
    adls_manager: AdlsBlobManager = current_app.config[CONFIG_USER_BLOB_MANAGER]
    files = await adls_manager.list_blobs(user_oid)
    return jsonify(files), 200


@bp.before_app_serving
async def setup_clients():
    # Replace these with your own values, either in environment variables or directly here
    AZURE_STORAGE_ACCOUNT = os.environ["AZURE_STORAGE_ACCOUNT"]
    AZURE_STORAGE_CONTAINER = os.environ["AZURE_STORAGE_CONTAINER"]
    AZURE_IMAGESTORAGE_CONTAINER = os.environ.get("AZURE_IMAGESTORAGE_CONTAINER")
    AZURE_USERSTORAGE_ACCOUNT = os.environ.get("AZURE_USERSTORAGE_ACCOUNT")
    AZURE_USERSTORAGE_CONTAINER = os.environ.get("AZURE_USERSTORAGE_CONTAINER")
    AZURE_SEARCH_SERVICE = os.environ["AZURE_SEARCH_SERVICE"]
    AZURE_SEARCH_ENDPOINT = f"https://{AZURE_SEARCH_SERVICE}.search.windows.net"
    AZURE_SEARCH_INDEX = os.environ["AZURE_SEARCH_INDEX"]
    AZURE_SEARCH_KNOWLEDGEBASE_NAME = os.getenv("AZURE_SEARCH_KNOWLEDGEBASE_NAME", "")
    # Shared by all OpenAI deployments
    OPENAI_HOST = OpenAIHost(os.getenv("OPENAI_HOST", "azure"))
    OPENAI_CHATGPT_MODEL = os.environ["AZURE_OPENAI_CHATGPT_MODEL"]
    AZURE_OPENAI_KNOWLEDGEBASE_MODEL = os.getenv("AZURE_OPENAI_KNOWLEDGEBASE_MODEL")
    AZURE_OPENAI_KNOWLEDGEBASE_DEPLOYMENT = os.getenv("AZURE_OPENAI_KNOWLEDGEBASE_DEPLOYMENT")
    OPENAI_EMB_MODEL = os.getenv("AZURE_OPENAI_EMB_MODEL_NAME", "text-embedding-ada-002")
    OPENAI_EMB_DIMENSIONS = int(os.getenv("AZURE_OPENAI_EMB_DIMENSIONS") or 1536)
    OPENAI_REASONING_EFFORT = os.getenv("AZURE_OPENAI_REASONING_EFFORT")
    # Used with Azure OpenAI deployments
    AZURE_OPENAI_SERVICE = os.getenv("AZURE_OPENAI_SERVICE")
    AZURE_OPENAI_CHATGPT_DEPLOYMENT = (
        os.getenv("AZURE_OPENAI_CHATGPT_DEPLOYMENT")
        if OPENAI_HOST in [OpenAIHost.AZURE, OpenAIHost.AZURE_CUSTOM]
        else None
    )
    AZURE_OPENAI_EMB_DEPLOYMENT = (
        os.getenv("AZURE_OPENAI_EMB_DEPLOYMENT") if OPENAI_HOST in [OpenAIHost.AZURE, OpenAIHost.AZURE_CUSTOM] else None
    )
    AZURE_OPENAI_CUSTOM_URL = os.getenv("AZURE_OPENAI_CUSTOM_URL")
    AZURE_VISION_ENDPOINT = os.getenv("AZURE_VISION_ENDPOINT", "")
    AZURE_OPENAI_API_KEY_OVERRIDE = os.getenv("AZURE_OPENAI_API_KEY_OVERRIDE")
    # Used only with non-Azure OpenAI deployments
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    OPENAI_ORGANIZATION = os.getenv("OPENAI_ORGANIZATION")

    AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID")
    AZURE_USE_AUTHENTICATION = os.getenv("AZURE_USE_AUTHENTICATION", "").lower() == "true"
    AZURE_ENFORCE_ACCESS_CONTROL = os.getenv("AZURE_ENFORCE_ACCESS_CONTROL", "").lower() == "true"
    AZURE_ENABLE_UNAUTHENTICATED_ACCESS = os.getenv("AZURE_ENABLE_UNAUTHENTICATED_ACCESS", "").lower() == "true"
    AZURE_SERVER_APP_ID = os.getenv("AZURE_SERVER_APP_ID")
    AZURE_SERVER_APP_SECRET = os.getenv("AZURE_SERVER_APP_SECRET")
    AZURE_CLIENT_APP_ID = os.getenv("AZURE_CLIENT_APP_ID")
    AZURE_AUTH_TENANT_ID = os.getenv("AZURE_AUTH_TENANT_ID", AZURE_TENANT_ID)

    KB_FIELDS_CONTENT = os.getenv("KB_FIELDS_CONTENT", "content")
    KB_FIELDS_SOURCEPAGE = os.getenv("KB_FIELDS_SOURCEPAGE", "sourcepage")

    AZURE_SEARCH_QUERY_LANGUAGE = os.getenv("AZURE_SEARCH_QUERY_LANGUAGE") or "en-us"
    AZURE_SEARCH_QUERY_SPELLER = os.getenv("AZURE_SEARCH_QUERY_SPELLER") or "lexicon"
    AZURE_SEARCH_SEMANTIC_RANKER = os.getenv("AZURE_SEARCH_SEMANTIC_RANKER", "free").lower()
    AZURE_SEARCH_QUERY_REWRITING = os.getenv("AZURE_SEARCH_QUERY_REWRITING", "false").lower()
    # This defaults to the previous field name "embedding", for backwards compatibility
    AZURE_SEARCH_FIELD_NAME_EMBEDDING = os.getenv("AZURE_SEARCH_FIELD_NAME_EMBEDDING", "embedding")

    AZURE_SPEECH_SERVICE_ID = os.getenv("AZURE_SPEECH_SERVICE_ID")
    AZURE_SPEECH_SERVICE_LOCATION = os.getenv("AZURE_SPEECH_SERVICE_LOCATION")
    AZURE_SPEECH_SERVICE_VOICE = os.getenv("AZURE_SPEECH_SERVICE_VOICE") or "en-US-AndrewMultilingualNeural"

    USE_MULTIMODAL = os.getenv("USE_MULTIMODAL", "").lower() == "true"
    RAG_SEARCH_TEXT_EMBEDDINGS = os.getenv("RAG_SEARCH_TEXT_EMBEDDINGS", "true").lower() == "true"
    RAG_SEARCH_IMAGE_EMBEDDINGS = os.getenv("RAG_SEARCH_IMAGE_EMBEDDINGS", "true").lower() == "true"
    RAG_SEND_TEXT_SOURCES = os.getenv("RAG_SEND_TEXT_SOURCES", "true").lower() == "true"
    RAG_SEND_IMAGE_SOURCES = os.getenv("RAG_SEND_IMAGE_SOURCES", "true").lower() == "true"
    USE_USER_UPLOAD = os.getenv("USE_USER_UPLOAD", "").lower() == "true"
    ENABLE_LANGUAGE_PICKER = os.getenv("ENABLE_LANGUAGE_PICKER", "").lower() == "true"
    USE_SPEECH_INPUT_BROWSER = os.getenv("USE_SPEECH_INPUT_BROWSER", "").lower() == "true"
    USE_SPEECH_OUTPUT_BROWSER = os.getenv("USE_SPEECH_OUTPUT_BROWSER", "").lower() == "true"
    USE_SPEECH_OUTPUT_AZURE = os.getenv("USE_SPEECH_OUTPUT_AZURE", "").lower() == "true"
    USE_CHAT_HISTORY_BROWSER = os.getenv("USE_CHAT_HISTORY_BROWSER", "").lower() == "true"
    USE_CHAT_HISTORY_COSMOS = os.getenv("USE_CHAT_HISTORY_COSMOS", "").lower() == "true"
    USE_AGENTIC_KNOWLEDGEBASE = os.getenv("USE_AGENTIC_KNOWLEDGEBASE", "").lower() == "true"
    USE_WEB_SOURCE = os.getenv("USE_WEB_SOURCE", "").lower() == "true"
    USE_SHAREPOINT_SOURCE = os.getenv("USE_SHAREPOINT_SOURCE", "").lower() == "true"
    AGENTIC_KNOWLEDGEBASE_REASONING_EFFORT = os.getenv("AGENTIC_KNOWLEDGEBASE_REASONING_EFFORT", "low")
    USE_VECTORS = os.getenv("USE_VECTORS", "").lower() != "false"

    # WEBSITE_HOSTNAME is always set by App Service, RUNNING_IN_PRODUCTION is set in main.bicep
    RUNNING_ON_AZURE = os.getenv("WEBSITE_HOSTNAME") is not None or os.getenv("RUNNING_IN_PRODUCTION") is not None

    # Use the current user identity for keyless authentication to Azure services.
    # This assumes you use 'azd auth login' locally, and managed identity when deployed on Azure.
    # The managed identity is setup in the infra/ folder.
    azure_credential: AzureDeveloperCliCredential | ManagedIdentityCredential
    azure_ai_token_provider: Callable[[], Awaitable[str]]
    if RUNNING_ON_AZURE:
        current_app.logger.info("Setting up Azure credential using ManagedIdentityCredential")
        if AZURE_CLIENT_ID := os.getenv("AZURE_CLIENT_ID"):
            # ManagedIdentityCredential should use AZURE_CLIENT_ID if set in env, but its not working for some reason,
            # so we explicitly pass it in as the client ID here. This is necessary for user-assigned managed identities.
            current_app.logger.info(
                "Setting up Azure credential using ManagedIdentityCredential with client_id %s", AZURE_CLIENT_ID
            )
            azure_credential = ManagedIdentityCredential(client_id=AZURE_CLIENT_ID)
        else:
            current_app.logger.info("Setting up Azure credential using ManagedIdentityCredential")
            azure_credential = ManagedIdentityCredential()
    elif AZURE_TENANT_ID:
        current_app.logger.info(
            "Setting up Azure credential using AzureDeveloperCliCredential with tenant_id %s", AZURE_TENANT_ID
        )
        azure_credential = AzureDeveloperCliCredential(tenant_id=AZURE_TENANT_ID, process_timeout=60)
    else:
        current_app.logger.info("Setting up Azure credential using AzureDeveloperCliCredential for home tenant")
        azure_credential = AzureDeveloperCliCredential(process_timeout=60)
    azure_ai_token_provider = get_bearer_token_provider(
        azure_credential, "https://cognitiveservices.azure.com/.default"
    )

    # Set the Azure credential in the app config for use in other parts of the app
    current_app.config[CONFIG_CREDENTIAL] = azure_credential

    # Set up clients for AI Search and Storage
    search_client = SearchClient(
        endpoint=AZURE_SEARCH_ENDPOINT,
        index_name=AZURE_SEARCH_INDEX,
        credential=azure_credential,
    )

    knowledgebase_client = KnowledgeBaseRetrievalClient(
        endpoint=AZURE_SEARCH_ENDPOINT, knowledge_base_name=AZURE_SEARCH_KNOWLEDGEBASE_NAME, credential=azure_credential
    )
    knowledgebase_client_with_web = None
    knowledgebase_client_with_sharepoint = None
    knowledgebase_client_with_web_and_sharepoint = None

    if AZURE_SEARCH_KNOWLEDGEBASE_NAME:
        if USE_WEB_SOURCE:
            knowledgebase_client_with_web = KnowledgeBaseRetrievalClient(
                endpoint=AZURE_SEARCH_ENDPOINT,
                knowledge_base_name=f"{AZURE_SEARCH_KNOWLEDGEBASE_NAME}-with-web",
                credential=azure_credential,
            )
        if USE_SHAREPOINT_SOURCE:
            knowledgebase_client_with_sharepoint = KnowledgeBaseRetrievalClient(
                endpoint=AZURE_SEARCH_ENDPOINT,
                knowledge_base_name=f"{AZURE_SEARCH_KNOWLEDGEBASE_NAME}-with-sp",
                credential=azure_credential,
            )
        if USE_WEB_SOURCE and USE_SHAREPOINT_SOURCE:
            knowledgebase_client_with_web_and_sharepoint = KnowledgeBaseRetrievalClient(
                endpoint=AZURE_SEARCH_ENDPOINT,
                knowledge_base_name=f"{AZURE_SEARCH_KNOWLEDGEBASE_NAME}-with-web-and-sp",
                credential=azure_credential,
            )

    # Set up the global blob storage manager (used for global content/images, but not user uploads)
    global_blob_manager = BlobManager(
        endpoint=f"https://{AZURE_STORAGE_ACCOUNT}.blob.core.windows.net",
        credential=azure_credential,
        container=AZURE_STORAGE_CONTAINER,
        image_container=AZURE_IMAGESTORAGE_CONTAINER,
    )
    current_app.config[CONFIG_GLOBAL_BLOB_MANAGER] = global_blob_manager

    # Set up authentication helper
    search_index = None
    if AZURE_USE_AUTHENTICATION:
        current_app.logger.info("AZURE_USE_AUTHENTICATION is true, setting up search index client")
        search_index_client = SearchIndexClient(
            endpoint=AZURE_SEARCH_ENDPOINT,
            credential=azure_credential,
        )
        search_index = await search_index_client.get_index(AZURE_SEARCH_INDEX)
        await search_index_client.close()
    auth_helper = AuthenticationHelper(
        search_index=search_index,
        use_authentication=AZURE_USE_AUTHENTICATION,
        server_app_id=AZURE_SERVER_APP_ID,
        server_app_secret=AZURE_SERVER_APP_SECRET,
        client_app_id=AZURE_CLIENT_APP_ID,
        tenant_id=AZURE_AUTH_TENANT_ID,
        enforce_access_control=AZURE_ENFORCE_ACCESS_CONTROL,
        enable_unauthenticated_access=AZURE_ENABLE_UNAUTHENTICATED_ACCESS,
    )

    if USE_SPEECH_OUTPUT_AZURE:
        current_app.logger.info("USE_SPEECH_OUTPUT_AZURE is true, setting up Azure speech service")
        if not AZURE_SPEECH_SERVICE_ID or AZURE_SPEECH_SERVICE_ID == "":
            raise ValueError("Azure speech resource not configured correctly, missing AZURE_SPEECH_SERVICE_ID")
        if not AZURE_SPEECH_SERVICE_LOCATION or AZURE_SPEECH_SERVICE_LOCATION == "":
            raise ValueError("Azure speech resource not configured correctly, missing AZURE_SPEECH_SERVICE_LOCATION")
        current_app.config[CONFIG_SPEECH_SERVICE_ID] = AZURE_SPEECH_SERVICE_ID
        current_app.config[CONFIG_SPEECH_SERVICE_LOCATION] = AZURE_SPEECH_SERVICE_LOCATION
        current_app.config[CONFIG_SPEECH_SERVICE_VOICE] = AZURE_SPEECH_SERVICE_VOICE
        # Wait until token is needed to fetch for the first time
        current_app.config[CONFIG_SPEECH_SERVICE_TOKEN] = None

    openai_client, azure_openai_endpoint = setup_openai_client(
        openai_host=OPENAI_HOST,
        azure_credential=azure_credential,
        azure_openai_service=AZURE_OPENAI_SERVICE,
        azure_openai_custom_url=AZURE_OPENAI_CUSTOM_URL,
        azure_openai_api_key=AZURE_OPENAI_API_KEY_OVERRIDE,
        openai_api_key=OPENAI_API_KEY,
        openai_organization=OPENAI_ORGANIZATION,
    )

    user_blob_manager = None
    if USE_USER_UPLOAD:
        current_app.logger.info("USE_USER_UPLOAD is true, setting up user upload feature")
        if not AZURE_USERSTORAGE_ACCOUNT or not AZURE_USERSTORAGE_CONTAINER:
            raise ValueError(
                "AZURE_USERSTORAGE_ACCOUNT and AZURE_USERSTORAGE_CONTAINER must be set when USE_USER_UPLOAD is true"
            )
        if not AZURE_ENFORCE_ACCESS_CONTROL:
            raise ValueError("AZURE_ENFORCE_ACCESS_CONTROL must be true when USE_USER_UPLOAD is true")
        user_blob_manager = AdlsBlobManager(
            endpoint=f"https://{AZURE_USERSTORAGE_ACCOUNT}.dfs.core.windows.net",
            container=AZURE_USERSTORAGE_CONTAINER,
            credential=azure_credential,
        )
        current_app.config[CONFIG_USER_BLOB_MANAGER] = user_blob_manager

        # Set up ingester
        file_processors, figure_processor = setup_file_processors(
            azure_credential=azure_credential,
            document_intelligence_service=os.getenv("AZURE_DOCUMENTINTELLIGENCE_SERVICE"),
            local_pdf_parser=os.getenv("USE_LOCAL_PDF_PARSER", "").lower() == "true",
            local_html_parser=os.getenv("USE_LOCAL_HTML_PARSER", "").lower() == "true",
            use_content_understanding=os.getenv("USE_CONTENT_UNDERSTANDING", "").lower() == "true",
            content_understanding_endpoint=os.getenv("AZURE_CONTENTUNDERSTANDING_ENDPOINT"),
            use_multimodal=USE_MULTIMODAL,
            openai_client=openai_client,
            openai_model=OPENAI_CHATGPT_MODEL,
            openai_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT if OPENAI_HOST == OpenAIHost.AZURE else None,
        )
        search_info = setup_search_info(
            search_service=AZURE_SEARCH_SERVICE,
            index_name=AZURE_SEARCH_INDEX,
            azure_credential=azure_credential,
            use_agentic_knowledgebase=USE_AGENTIC_KNOWLEDGEBASE,
            azure_openai_endpoint=azure_openai_endpoint,
            knowledgebase_name=AZURE_SEARCH_KNOWLEDGEBASE_NAME,
            azure_openai_knowledgebase_deployment=AZURE_OPENAI_KNOWLEDGEBASE_DEPLOYMENT,
            azure_openai_knowledgebase_model=AZURE_OPENAI_KNOWLEDGEBASE_MODEL,
        )

        text_embeddings_service = None
        if USE_VECTORS:
            text_embeddings_service = setup_embeddings_service(
                open_ai_client=openai_client,
                openai_host=OPENAI_HOST,
                emb_model_name=OPENAI_EMB_MODEL,
                emb_model_dimensions=OPENAI_EMB_DIMENSIONS,
                azure_openai_deployment=AZURE_OPENAI_EMB_DEPLOYMENT,
                azure_openai_endpoint=azure_openai_endpoint,
            )

        image_embeddings_service = setup_image_embeddings_service(
            azure_credential=azure_credential,
            vision_endpoint=AZURE_VISION_ENDPOINT,
            use_multimodal=USE_MULTIMODAL,
        )
        ingester = UploadUserFileStrategy(
            search_info=search_info,
            file_processors=file_processors,
            embeddings=text_embeddings_service,
            image_embeddings=image_embeddings_service,
            search_field_name_embedding=AZURE_SEARCH_FIELD_NAME_EMBEDDING,
            blob_manager=user_blob_manager,
            figure_processor=figure_processor,
        )
        current_app.config[CONFIG_INGESTER] = ingester

    image_embeddings_client = None
    if USE_MULTIMODAL:
        image_embeddings_client = ImageEmbeddings(AZURE_VISION_ENDPOINT, azure_ai_token_provider)

    current_app.config[CONFIG_OPENAI_CLIENT] = openai_client
    current_app.config[CONFIG_SEARCH_CLIENT] = search_client
    current_app.config[CONFIG_KNOWLEDGEBASE_CLIENT] = knowledgebase_client
    current_app.config[CONFIG_KNOWLEDGEBASE_CLIENT_WITH_WEB] = knowledgebase_client_with_web
    current_app.config[CONFIG_KNOWLEDGEBASE_CLIENT_WITH_SHAREPOINT] = knowledgebase_client_with_sharepoint
    current_app.config[CONFIG_KNOWLEDGEBASE_CLIENT_WITH_WEB_AND_SHAREPOINT] = (
        knowledgebase_client_with_web_and_sharepoint
    )
    current_app.config[CONFIG_AUTH_CLIENT] = auth_helper

    current_app.config[CONFIG_SEMANTIC_RANKER_DEPLOYED] = AZURE_SEARCH_SEMANTIC_RANKER != "disabled"
    current_app.config[CONFIG_QUERY_REWRITING_ENABLED] = (
        AZURE_SEARCH_QUERY_REWRITING == "true" and AZURE_SEARCH_SEMANTIC_RANKER != "disabled"
    )
    current_app.config[CONFIG_DEFAULT_REASONING_EFFORT] = OPENAI_REASONING_EFFORT
    current_app.config[CONFIG_DEFAULT_RETRIEVAL_REASONING_EFFORT] = AGENTIC_KNOWLEDGEBASE_REASONING_EFFORT
    current_app.config[CONFIG_REASONING_EFFORT_ENABLED] = OPENAI_CHATGPT_MODEL in Approach.GPT_REASONING_MODELS
    current_app.config[CONFIG_STREAMING_ENABLED] = (
        OPENAI_CHATGPT_MODEL not in Approach.GPT_REASONING_MODELS
        or Approach.GPT_REASONING_MODELS[OPENAI_CHATGPT_MODEL].streaming
    )
    current_app.config[CONFIG_VECTOR_SEARCH_ENABLED] = bool(USE_VECTORS)
    current_app.config[CONFIG_USER_UPLOAD_ENABLED] = bool(USE_USER_UPLOAD)
    current_app.config[CONFIG_LANGUAGE_PICKER_ENABLED] = ENABLE_LANGUAGE_PICKER
    current_app.config[CONFIG_SPEECH_INPUT_ENABLED] = USE_SPEECH_INPUT_BROWSER
    current_app.config[CONFIG_SPEECH_OUTPUT_BROWSER_ENABLED] = USE_SPEECH_OUTPUT_BROWSER
    current_app.config[CONFIG_SPEECH_OUTPUT_AZURE_ENABLED] = USE_SPEECH_OUTPUT_AZURE
    current_app.config[CONFIG_CHAT_HISTORY_BROWSER_ENABLED] = USE_CHAT_HISTORY_BROWSER
    current_app.config[CONFIG_CHAT_HISTORY_COSMOS_ENABLED] = USE_CHAT_HISTORY_COSMOS
    # Incidents persistence (Session 3) rides on the same Cosmos account; defaults to off when
    # USE_CHAT_HISTORY_COSMOS is false. The setup helper installs the container proxy.
    await incidents_cosmos.setup_incidents_cosmos()
    current_app.config[CONFIG_AGENTIC_KNOWLEDGEBASE_ENABLED] = USE_AGENTIC_KNOWLEDGEBASE
    current_app.config[CONFIG_MULTIMODAL_ENABLED] = USE_MULTIMODAL
    current_app.config[CONFIG_RAG_SEARCH_TEXT_EMBEDDINGS] = RAG_SEARCH_TEXT_EMBEDDINGS
    current_app.config[CONFIG_RAG_SEARCH_IMAGE_EMBEDDINGS] = RAG_SEARCH_IMAGE_EMBEDDINGS
    current_app.config[CONFIG_RAG_SEND_TEXT_SOURCES] = RAG_SEND_TEXT_SOURCES
    current_app.config[CONFIG_RAG_SEND_IMAGE_SOURCES] = RAG_SEND_IMAGE_SOURCES
    current_app.config[CONFIG_WEB_SOURCE_ENABLED] = USE_WEB_SOURCE
    if AGENTIC_KNOWLEDGEBASE_REASONING_EFFORT == "minimal" and current_app.config[CONFIG_WEB_SOURCE_ENABLED]:
        raise ValueError("Web source cannot be used with minimal retrieval reasoning effort")
    current_app.config[CONFIG_SHAREPOINT_SOURCE_ENABLED] = USE_SHAREPOINT_SOURCE

    prompt_manager = PromptManager()

    # ValidateIAPApproach is used by /api/incidents/{id}/validate-iap for the Fire Officer
    # kiosk's structured extraction. Pure LLM extraction in v1; KB retrieval added later.
    current_app.config[CONFIG_VALIDATE_IAP_APPROACH] = ValidateIAPApproach(
        openai_client=openai_client,
        chatgpt_model=OPENAI_CHATGPT_MODEL,
        chatgpt_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    )

    # RefineConditionApproach is used by the Fire Officer's "Refine Condition" UX
    # (Session 4): two LLM calls — three narrowing statements, then re-evaluate after the
    # FO picks one. Shares the OpenAI client / model deployment with ValidateIAPApproach.
    current_app.config[CONFIG_REFINE_CONDITION_APPROACH] = RefineConditionApproach(
        openai_client=openai_client,
        chatgpt_model=OPENAI_CHATGPT_MODEL,
        chatgpt_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    )

    # RecommendActionsApproach (Session 5b): generates 3-5 role-specific recommended
    # actions for support roles, given the scene state + already-published + recently-
    # dismissed. Each refresh call replaces the role's pending working set in Cosmos.
    current_app.config[CONFIG_RECOMMEND_ACTIONS_APPROACH] = RecommendActionsApproach(
        openai_client=openai_client,
        chatgpt_model=OPENAI_CHATGPT_MODEL,
        chatgpt_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    )

    # ExtractFormsApproach (5d): downstream extractor that runs after ValidateIAPApproach
    # and populates the 27 role-tagged ICS forms. Same OpenAI client / model — the
    # cost/latency tradeoff is one extra chat completion per Validate IAP press.
    current_app.config[CONFIG_EXTRACT_FORMS_APPROACH] = ExtractFormsApproach(
        openai_client=openai_client,
        chatgpt_model=OPENAI_CHATGPT_MODEL,
        chatgpt_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    )

    # ChatReadRetrieveReadApproach is used by /chat for multi-turn conversation
    current_app.config[CONFIG_CHAT_APPROACH] = ChatReadRetrieveReadApproach(
        search_client=search_client,
        search_index_name=AZURE_SEARCH_INDEX,
        knowledgebase_model=AZURE_OPENAI_KNOWLEDGEBASE_MODEL,
        knowledgebase_deployment=AZURE_OPENAI_KNOWLEDGEBASE_DEPLOYMENT,
        knowledgebase_client=knowledgebase_client,
        knowledgebase_client_with_web=knowledgebase_client_with_web,
        knowledgebase_client_with_sharepoint=knowledgebase_client_with_sharepoint,
        knowledgebase_client_with_web_and_sharepoint=knowledgebase_client_with_web_and_sharepoint,
        openai_client=openai_client,
        chatgpt_model=OPENAI_CHATGPT_MODEL,
        chatgpt_deployment=AZURE_OPENAI_CHATGPT_DEPLOYMENT,
        embedding_model=OPENAI_EMB_MODEL,
        embedding_deployment=AZURE_OPENAI_EMB_DEPLOYMENT,
        embedding_dimensions=OPENAI_EMB_DIMENSIONS,
        embedding_field=AZURE_SEARCH_FIELD_NAME_EMBEDDING,
        sourcepage_field=KB_FIELDS_SOURCEPAGE,
        content_field=KB_FIELDS_CONTENT,
        query_language=AZURE_SEARCH_QUERY_LANGUAGE,
        query_speller=AZURE_SEARCH_QUERY_SPELLER,
        prompt_manager=prompt_manager,
        reasoning_effort=OPENAI_REASONING_EFFORT,
        multimodal_enabled=USE_MULTIMODAL,
        image_embeddings_client=image_embeddings_client,
        global_blob_manager=global_blob_manager,
        user_blob_manager=user_blob_manager,
        use_web_source=current_app.config[CONFIG_WEB_SOURCE_ENABLED],
        use_sharepoint_source=current_app.config[CONFIG_SHAREPOINT_SOURCE_ENABLED],
        retrieval_reasoning_effort=AGENTIC_KNOWLEDGEBASE_REASONING_EFFORT,
    )


@bp.after_app_serving
async def close_clients():
    await current_app.config[CONFIG_SEARCH_CLIENT].close()
    await current_app.config[CONFIG_GLOBAL_BLOB_MANAGER].close_clients()
    if user_blob_manager := current_app.config.get(CONFIG_USER_BLOB_MANAGER):
        await user_blob_manager.close_clients()
    await current_app.config[CONFIG_CREDENTIAL].close()


def create_app():
    app = Quart(__name__)
    app.register_blueprint(bp)
    app.register_blueprint(chat_history_cosmosdb_bp)

    # Log levels should be one of https://docs.python.org/3/library/logging.html#logging-levels
    # Set root level to WARNING to avoid seeing overly verbose logs from SDKS
    logging.basicConfig(level=logging.WARNING)
    # Set our own logger levels to INFO by default
    app_level = os.getenv("APP_LOG_LEVEL", "INFO")
    app.logger.setLevel(os.getenv("APP_LOG_LEVEL", app_level))
    logging.getLogger("scripts").setLevel(app_level)

    if allowed_origin := os.getenv("ALLOWED_ORIGIN"):
        allowed_origins = allowed_origin.split(";")
        if len(allowed_origins) > 0:
            app.logger.info("CORS enabled for %s", allowed_origins)
            cors(app, allow_origin=allowed_origins, allow_methods=["GET", "POST"])

    return app


