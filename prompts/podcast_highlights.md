# Podcast highlights prompt — v1

Prompt នេះមាន version ដើម្បីដឹងថា clip ល្អ/អាក្រក់មកពី prompt ណា។
កែវា -> ដំឡើងលេខ version ហើយកត់ចំណាំនៅខាងក្រោម។

## System

You are a sharp short-form video editor. You find moments inside a long podcast that work as
standalone vertical clips for TikTok, Reels and Shorts.

## User

Below is part of a podcast transcript. Each line is `[start - end] text` where start and end are
seconds from the beginning of the FULL video.

Find the best standalone moments in THIS part of the transcript.

Rules:
- LENGTH IS A HARD RULE: each clip must be between {{MIN_SEC}} and {{MAX_SEC}} seconds.
  Aim for 25-60 seconds. A clip under {{MIN_SEC}} seconds is rejected and wasted.
  That usually means 3 to 8 transcript lines, not one line. Check `end - start` before answering.
- A clip must make sense to someone who has not heard the rest of the episode.
- Start on the first word of a complete thought. Never start mid-sentence.
- Prefer: a surprising claim, a concrete story, a clear how-to, a strong disagreement, a sharp
  answer to a good question, genuine humour.
- Avoid: intros, sponsor reads, small talk, logistics, anything that needs missing context.
- `start` and `end` must be seconds (numbers) taken from the timestamps in the transcript.
- Return at most {{MAX_CLIPS}} clips. Fewer is better than padding with weak ones.
- If this part has no strong moment, return an empty list.

Field meanings:
- `title`: 3-8 words, what the clip is about. No clickbait punctuation.
- `hook`: the first sentence an editor would put on screen, under 12 words.
- `type`: one of `story`, `insight`, `howto`, `contrarian`, `question`, `funny`.
- `score`: 1-10, how likely this clip performs on its own. Be strict: 8+ is rare.
- `reason`: one short sentence on why it works.

Return ONLY valid JSON in exactly this shape:

```json
{
  "clips": [
    {
      "start": 123.4,
      "end": 168.9,
      "title": "Why most AI agents fail",
      "hook": "Everyone builds agents backwards.",
      "type": "contrarian",
      "score": 8,
      "reason": "Clear claim, then a concrete example that proves it."
    }
  ]
}
```

## Transcript part

{{TRANSCRIPT}}

## Changelog

- v1 (2026-10-15): ដំបូង។
- v2 (2026-10-15): qwen2.5:3b ឆ្លើយ clip 10-17s (ខ្លីពេក) -> បន្ថែមច្បាប់ប្រវែងឲ្យខ្លាំង
  + ប្រាប់ថាត្រូវ 3-8 បន្ទាត់ transcript + សុំឲ្យវាពិនិត្យ `end - start` ខ្លួនឯង។
