# Detect genre prompt — v3

Prompt នេះឲ្យ LLM ស្គាល់ប្រភេទវីដេអូពីផ្នែកខ្លីៗនៃ transcript។
កែវា -> ដំឡើងលេខ version ហើយកត់ចំណាំនៅខាងក្រោម។

## System

You classify videos by reading their transcript. You answer only from what is said, and you say
"other" rather than guess.

## User

Below are short excerpts from the start, middle and end of one video's transcript. Decide which
genres the video belongs to. A video can have more than one: give the main genre first, and a second
only if a large part of the video clearly is that too. Most videos have one.

- `qa`: an audience or host asks questions and a guest answers them, one after another.
- `commentary`: one person gives their opinion on news, a topic or someone else's content.
- `marketing`: the video exists to promote a product, service or brand.
- `webinar`: a live or recorded training session, product demo or presentation with slides.
- `motivational`: one speaker alone, giving a speech meant to inspire the listener to change or act.
- `podcast`: a long, relaxed conversation between two or more people.
- `academic`: a lecture or lesson that teaches a subject.
- `other`: none of these fit (comedy, vlog, wildlife, gaming...), or you cannot tell.

Judge the format, not the topic: who is talking, to whom, and how. First decide whether one person
or several people speak ("you", replies, "yeah", interruptions mean several). A conversation about
success or building skills is still a conversation, not `motivational`.
A sponsor message inside a video does not make it `marketing`. Judge the video, not one excerpt.

Return ONLY valid JSON in exactly this shape:

```json
{"genres": ["podcast"], "reason": "Under 15 words, what in the transcript shows this"}
```

## Transcript part

{{TRANSCRIPT}}

## Changelog

- v1 (2026-11-02): ដំបូង។
- v2 (2026-11-02): How-AI-agents (ការសន្ទនាតាម webcam) ចេញ `motivational` ទាំងពីរដង ព្រោះ model
  មើលប្រធានបទ -> ប្រាប់ឲ្យមើលទម្រង់ (នរណានិយាយ) មុន។
- v3 (2026-11-02): វីដេអូមួយអាចមានច្រើន genre (អ្នកអភិវឌ្ឍន៍ស្នើ) -> ឆ្លើយ `genres` 1-2។
