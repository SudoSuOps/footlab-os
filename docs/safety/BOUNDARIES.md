# Product Safety Boundaries

## FootLabOS may

- Guide consistent photo capture.
- Check whether required images are present and usable.
- Describe structured visual observations.
- Compare current observations with prior observations.
- Surface changes for human attention.
- Organize client-reported symptoms/context.
- Route items according to configured review rules.
- Track insert/device versions, fabrication, QA, and wear feedback.
- Draft concise communications for human-approved workflows.

## FootLabOS must not autonomously

- Diagnose a disease or wound condition.
- Declare a foot, wound, or client medically safe.
- Prescribe medication or medical treatment.
- Tell a client to ignore urgent symptoms because an image appears unchanged.
- Represent an AI model, agent, operator, or manufacturing employee as a licensed clinician.
- Change an insert design based solely on a model output without the required human/design workflow.
- Share client content outside the configured environment without the required consent and authorization.

## Escalation principle

When configured signals indicate that human review is appropriate, FootLabOS should route the case and clearly communicate the next human step. The product should preserve uncertainty rather than manufacturing certainty.

## Language rule

Prefer language such as:
- "change observed"
- "needs review"
- "please contact your care team"
- "this system does not diagnose"

Avoid language such as:
- "you are cleared"
- "no infection"
- "this is definitely..."
- "the AI doctor says..."
