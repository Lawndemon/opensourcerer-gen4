/**
 * Synthetic transcript fixtures for the kiosk demo.
 *
 * Mirrors the JSON fixtures in `app/backend/fixtures/transcripts/`. Bundled as a frontend
 * constant for the prototype so the demo doesn't need a "list fixtures" endpoint. Once
 * streaming STT lands and real radio chatter feeds the transcript, this file goes away.
 *
 * Multi-phase (scene segments): each scenario's chatter is split into one or more PHASES.
 * A phase holds only the NEW chatter that arrives in that segment; the kiosk concatenates
 * phase[0..n] and runs Validate against the union (see IncidentKiosk handleRunPhase). This
 * is what lets a Phase-1 green condition deteriorate to red by a later phase. Single-segment
 * scenarios are simply length-1 phase arrays.
 *
 * NOTE on terminology: in the data model these are "scene segments" within the Response
 * phase, NOT lifecycle phases (Response → Transition to Recovery → Recovery). The demo
 * button label says "Run Phase N" because that's the SME's language; the construct is a
 * scene segment.
 *
 * To swap in updated transcripts: copy the `phases` from the corresponding JSON fixture in
 * the backend.
 */

export interface KioskScenario {
    id: string;
    label: string;
    blurb: string;
    /** New chatter per scene segment. Length 1 = single-segment scenario (no Run Phase button). */
    phases: string[];
}

/** Sentinel id for the "bring your own transcript" option in the kiosk picker.
 *  Not a real fixture — the kiosk renders a textarea + file input when this is selected. */
export const CUSTOM_SCENARIO_ID = "__custom__";

export const KIOSK_SCENARIOS: KioskScenario[] = [
    {
        id: "single_family_exposure",
        label: "SME — Single Family Structure Fire with Exposure (4 phases)",
        blurb:
            "SME multi-phase script. Goes well, then deteriorates: offensive with family out → heavy smoke / soft floor / crew withdraws → defensive + Bravo exposure → Delta exposure heating up, mutual aid inbound. Press Run Phase to feed each new wave of chatter.",
        phases: [
            // Phase 1 — on scene, offensive, family evacuated, fire in basement (pre first "Validate IAP")
            [
                "Dispatch from engine one",
                "Go ahead engine one",
                "Engine one is on scene at 10002 106 street, we have a two-story single-family residence with smoke and fire showing, family appears to be evacuated on the front lawn. Crews are establishing a water supply and preparing for entry through the front door, we are in offensive mode. Continue to deploy ladder 1 and call mutual aid. Hughes is assuming command. Stand by for follow up report",
                "360 is complete, fire appears to be in Charlie-delta corner of basement, will remain in offensive strategy. Family has confirmed they are all accounted for. Accountability is alpha side."
            ].join("\n"),
            // Phase 2 — crew enters, heavy smoke / soft floor, fire attack exits
            [
                "Dispatch from engine two",
                "Go ahead engine two",
                "Engine two is en route, four on board",
                "Dispatch copies, engine two showing en route, four on board.",
                "Dispatch from command",
                "Go ahead command",
                "Two firefighers entering structure on air for fire attack",
                "Dispatch copies, two entering for fire attack",
                "Command from fire attack",
                "Go ahead for command",
                "Fire attack is at the entrance to the basement, smoke conditions are heavy and floor is soft, fire attack exiting the structure",
                "Command copies, fire condions are severe and fire attack is exiting."
            ].join("\n"),
            // Phase 3 — switch to defensive, Bravo exposure, mutual aid 35 min
            [
                "Dispatch from command, switching to defensive strategy. Please call out mutual aid, requesting aerial unit.",
                "Dispatch copies, requesting aerial from mutual aid.",
                "Dispatch from engine 2",
                "Go ahead engine 2",
                "Engine 2 is on scene, checking in with command",
                "Engine 2 from command",
                "Go for engine 2",
                "Engine 2, spot to best advantage and cover the bravo exposure.",
                "Engine 2 copies, will spot to best advantage, secure water supply and cover bravo exposure.",
                "Command from dispatch",
                "Go for command",
                "Mutual aid being dispatched from Cogswell, ETA 35 minutes."
            ].join("\n"),
            // Phase 4 — Delta exposure getting hot, more units, Cogswell platform arrives
            [
                "Dispatch from command",
                "Go for dispatch",
                "Delta exposure is getting hot, engine one is moving over to delta exposure protection. Additional units from mutual aid requested.",
                "Dispatch copies, engine one on delta exposure, requesting additional units.",
                "Dispatch to command",
                "Go for command",
                "Mutual aid coming from Cogswell, one additional engine crew, eta 45 minutes.",
                "Command copies, 45 minutes for additional engine.",
                "Command from Cogswell platform one",
                "Go for command",
                "Plat one is on scene."
            ].join("\n")
        ]
    },
    {
        id: "residential_conforming",
        label: "Residential structure fire (by-the-book)",
        blurb:
            "Two-story SFR working fire. By-the-book response — most extracted items should be green.",
        phases: [
            [
                "14:32:15 — Engine 1: Engine 1 on scene, two-story single-family residential, working fire showing Charlie side, smoke from Bravo. Civilians out front, all accounted for per neighbour.",
                "14:32:30 — Captain Reyes: Engine 1 establishing Maple Street Command. 360 walkaround in progress.",
                "14:33:05 — Captain Reyes: 360 complete. Heavy smoke from Bravo and Charlie sides, no visible victims, parked vehicles cleared. Wind out of the southwest at five. Structure intact, no obvious collapse indicators. Offensive attack approved.",
                "14:33:40 — Captain Reyes: Engine 1, advance attack line, primary entry Alpha side. Truck 1, vertical ventilation over Charlie side coordinated with interior knockdown.",
                "14:34:10 — Engine 1: Attack line charged. Crew of two on the line, full PPE, SCBA in service. Advancing.",
                "14:34:25 — Captain Reyes: Engine 2 on scene, designated Rapid Intervention Team. Stage Alpha side, full PPE, RIT bag ready, in service before interior crew advances.",
                "14:34:40 — Engine 2: Engine 2 RIT in position, accountability complete.",
                "14:35:00 — Captain Reyes: All units, LACES check. Lookouts posted Alpha and Charlie. Escape route via point of entry. Safety Zone at the engine.",
                "14:35:30 — Truck 1: Vertical opened, vent established Charlie side.",
                "14:36:15 — Engine 1: Fire knockdown second floor, primary search underway.",
                "14:37:00 — Engine 1: Primary search complete, no victims. Beginning overhaul.",
                "14:38:45 — Captain Reyes: Fire under control. RIT remaining in service until secondary search complete.",
                "14:42:00 — Engine 1: Secondary all clear, fire fully extinguished, scene secured.",
                "14:42:30 — Captain Reyes: Maple Street Command terminated. Engine 2 RIT released. Engine 1 remaining for overhaul and investigation."
            ].join("\n")
        ]
    },
    {
        id: "mva_mixed",
        label: "MVA extrication (one yellow deviation)",
        blurb:
            "Single-vehicle MVA with mild entrapment. Mostly green plus one yellow — vehicle not chocked, vehicle is on its side and stable, no life risk.",
        phases: [
            [
                "09:14:22 — Engine 1: Engine 1 on scene, single-vehicle MVA, Range Road 245 mile fourteen. One vehicle on its side, in the ditch.",
                "09:14:35 — Captain Lin: Engine 1 Lin Command. One vehicle on driver's side, partially in ditch. Two occupants, both conscious and conversing. Mild entrapment, lower extremities pinned.",
                "09:15:00 — Captain Lin: Engine 1, scene size-up complete. Vehicle stable on driver's side, will not roll. No fire, fuel leak negligible. No pedestrian hazards. Roadway flagged, traffic control in place.",
                "09:15:30 — Engine 1: Initiating extrication, Hurst tool deploying for windshield removal.",
                "09:15:50 — Captain Lin: Medic 4 on scene, prepare to receive patients.",
                "09:16:00 — Engine 1: Battery disconnect, primary post complete. Vehicle electrical isolated.",
                "09:16:25 — Engine 1: Note for the IC: we did not chock. Vehicle is on its side, no movement risk, proceeding with extrication.",
                "09:16:35 — Captain Lin: Acknowledged. Continue.",
                "09:17:00 — Engine 1: Windshield removed, accessing patient one. C-spine precautions in place.",
                "09:18:15 — Engine 1: Patient one extricated, no acute distress, transferred to Medic 4 with collar.",
                "09:19:30 — Engine 1: Patient two extricated, ambulatory, minor laceration left forearm. Transferred to Medic 4.",
                "09:21:00 — Captain Lin: All patients transferred. Wreckage stabilized. Awaiting tow services. Range Road open to single-lane alternating traffic."
            ].join("\n")
        ]
    },
    {
        id: "commercial_life_risk",
        label: "Commercial fire (life-risk red)",
        blurb:
            "Commercial fire where IC orders interior attack without RIT in place and continues offensive after deteriorating conditions. Crew escapes a flashover unhurt.",
        phases: [
            [
                "22:08:42 — Engine 1: Engine 1 on scene, commercial occupancy, two-story, fully involved Bravo side, heavy smoke Charlie and Delta. Smoke is dark and turbulent.",
                "22:08:55 — Captain Walsh: Engine 1 Walsh Command. Two-story commercial. Heavy fire Bravo side, smoke heavy on three sides, color dark and turbulent.",
                "22:09:20 — Captain Walsh: Engine 1, advance attack line, interior Alpha side. Knock down the fire, push into Bravo.",
                "22:09:35 — Engine 1: Roger, advancing attack line. Crew of two, full PPE, SCBA in service.",
                "22:09:55 — Captain Walsh: Truck 1 on scene. Begin vertical ventilation Charlie side.",
                "22:10:20 — Engine 1: Inside Alpha. Heat banking down, smoke turbulent, moving fast.",
                "22:10:40 — Engine 2 inbound: Engine 2 inbound, ETA two minutes, designated RIT on arrival.",
                "22:10:55 — Captain Walsh: Engine 1, push the line, knock down the fire.",
                "22:11:10 — Engine 1: Captain, conditions are deteriorating. Smoke is rolling. Recommend transitional attack from exterior.",
                "22:11:25 — Captain Walsh: Negative, push the line. Knock down the fire.",
                "22:11:45 — Engine 1: Captain, no RIT in place yet. Engine 2 still two out.",
                "22:11:55 — Captain Walsh: Continue the attack. Engine 2 will set up on arrival.",
                "22:12:30 — Engine 1: Heat increasing rapidly. We are pulling back to the door.",
                "22:12:55 — Engine 1: At the door, fire flashed over the kitchen counter. Crew accountable, no injuries. We are out.",
                "22:13:15 — Captain Walsh: All units, withdraw. Going defensive. Engine 1 reset on the Alpha side, exterior knock down.",
                "22:13:45 — Engine 2: Engine 2 on scene, RIT staged Alpha side, in service.",
                "22:14:00 — Captain Walsh: Truck 1 continue ventilation. Engine 1 exterior attack, Bravo flank. Defensive operations only.",
                "22:18:30 — Captain Walsh: Knockdown achieved exterior. Holding defensive posture, no interior operations until structure assessed."
            ].join("\n")
        ]
    },
    {
        id: "initial_report_residential_fire",
        label: "SME — initial radio report (residential fire)",
        blurb:
            "SME-provided initial size-up: two-story SFR, smoke and fire showing, family evacuated, offensive, with a 360 follow-up. Short, naturalistic report.",
        phases: [
            [
                "Engine one is on scene at 10002 106 street, we have a two-story single-family residence with smoke and fire showing, family appears to be evacuated on the front lawn. Crews are establishing a water supply and preparing for entry through the front door, we are in offensive mode. Continue to deploy ladder 1 and call mutual aid. Hughes is assuming command. Stand by for follow up report",
                "360 is complete, fire appears to be in Charlie-delta corner of basement, will remain in offensive strategy. Family has confirmed they are all accounted for. Accountability is alpha side."
            ].join("\n")
        ]
    },
    {
        id: "initial_report_spacely_school_fire",
        label: "SME — initial radio report (Spacely school)",
        blurb:
            "SME-provided initial size-up: Spacely Sprockets high school, nothing showing, investigative mode, then 360 finds fire Charlie side and switches to offensive.",
        phases: [
            [
                "Engine one has arrived at spacely sprockets high school, nothing showing. Crews are preparing for entry through the main entrance, we are in investigative mode. Hold resources at the hall. Hughes is assuming command, standby for 360",
                "360 is complete, there is fire showing on the Charlie side of the structure, will switch to offensive strategy. Deploy remaining spacely sprockets resources and activate mutual aid. Accountability is alpha side."
            ].join("\n")
        ]
    }
];

export const DEFAULT_SCENARIO_ID = KIOSK_SCENARIOS[0].id;

export function getScenarioById(id: string): KioskScenario | undefined {
    return KIOSK_SCENARIOS.find(s => s.id === id);
}

/** Accumulated transcript through scene segment `phaseIndex` (inclusive). The Validate pass
 *  always runs against the union of phase[0..phaseIndex], which is what drives cross-phase
 *  reconciliation (items update in place as new evidence arrives). */
export function accumulatedTranscript(phases: string[], phaseIndex: number): string {
    return phases.slice(0, phaseIndex + 1).join("\n");
}
