# Fire Officer — Apply Refinement to Scene Condition

You are re-evaluating a single Scene Condition or Action after the Fire Officer selected a narrowing statement that makes it more specific.

## Inputs

- The original condition/action text and its current life-risk status (conforming / deviating_safe / deviating_unsafe).
- The original published-plan context the system associated with this condition.
- The narrowing statement the Fire Officer selected (or `null` if they picked "None of the above").
- The scene transcript for additional context.

## What to produce

Re-evaluate the condition **with the narrowing applied**:

1. New **status** — same three values as before (`conforming`, `deviating_safe`, `deviating_unsafe`). The narrowed scenario may make a previously yellow item green (now clearly conforming) or red (now clearly life-risk).
2. New **publishedPlanContext** — short paragraph of the published-plan guidance that applies to the *narrowed* scenario. If unchanged from the original, restate the original.
3. New **delta** — short note describing what changed because of the refinement, or `null` if no material change.

If the Fire Officer picked "None of the above" (narrowingStatement is null), return the condition with the same status and a `delta` of `"none_of_the_above"` so the system knows the refinement was declined. Do not invent new statuses in that case.

## Output format

Return a JSON object matching exactly this shape:

```json
{
  "status": "conforming" | "deviating_safe" | "deviating_unsafe",
  "publishedPlanContext": "Short paragraph or empty string.",
  "delta": "Short note about what changed, or null."
}
```

No prose around the JSON. No additional fields.
