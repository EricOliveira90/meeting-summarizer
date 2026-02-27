import { NoteTemplate } from "../domain";

export const noteTemplatesList: Record<NoteTemplate, string> = {
    [NoteTemplate.STD_MEETING]: `
---
tags:
  - Meeting
date: {{DATE}}
attendees:
---
{{SUMMARY}}
    `,
    [NoteTemplate.SELLER_MEETING]: `
---
tags:
  - Meeting
date: {{DATE}}
seller:
attendees:
---
{{SUMMARY}}
    `,
    [NoteTemplate.TRAINING]: `
---
tags:
  - Resource/Training
date: {{DATE}}
presenters:
---
{{SUMMARY}}
    `,
    [NoteTemplate.SUMMARY]: "# Brief Summary\n\n{{SUMMARY}}\n\n# Transcript\n\n{{TRANSCRIPT}}"
};