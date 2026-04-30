/**
 * Synthetic transcript fixtures for the kiosk demo.
 *
 * Mirrors the JSON fixtures in `app/backend/fixtures/transcripts/`. Bundled as a frontend
 * constant for the prototype so the demo doesn't need a "list fixtures" endpoint. Once
 * streaming STT lands and real radio chatter feeds the transcript, this file goes away.
 *
 * To swap in updated transcripts: copy the `transcript` field from the corresponding JSON
 * fixture in the backend.
 */

export interface KioskScenario {
    id: string;
    label: string;
    blurb: string;
    transcript: string;
}

export const KIOSK_SCENARIOS: KioskScenario[] = [
    {
        id: "residential_conforming",
        label: "Residential structure fire (by-the-book)",
        blurb:
            "Two-story SFR working fire. By-the-book response — most extracted items should be green.",
        transcript: [
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
    },
    {
        id: "mva_mixed",
        label: "MVA extrication (one yellow deviation)",
        blurb:
            "Single-vehicle MVA with mild entrapment. Mostly green plus one yellow — vehicle not chocked, vehicle is on its side and stable, no life risk.",
        transcript: [
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
    },
    {
        id: "commercial_life_risk",
        label: "Commercial fire (life-risk red)",
        blurb:
            "Commercial fire where IC orders interior attack without RIT in place and continues offensive after deteriorating conditions. Crew escapes a flashover unhurt.",
        transcript: [
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
    }
];

export const DEFAULT_SCENARIO_ID = KIOSK_SCENARIOS[0].id;

export function getScenarioById(id: string): KioskScenario | undefined {
    return KIOSK_SCENARIOS.find(s => s.id === id);
}
