# Rank clips prompt — v1

ជំហានទី ២ នៃការជ្រើស៖ ក្រោយពេលរក candidate ពីគ្រប់ chunk យើងសួរ model ម្តងទៀតឲ្យ
**ដាក់លំដាប់ធៀបគ្នា**។

**ហេតុអ្វីត្រូវមានជំហាននេះ?** យើងវាស់ឃើញថា `qwen2.5:7b-instruct` ឲ្យពិន្ទុ 9 ដល់
clip ស្ទើរគ្រប់ (v2: 9,9,9,9,9 | v3: 9,9,9,9,8) ទោះ prompt មាននិយមន័យពិន្ទុច្បាស់។
Model តូចវិនិច្ឆ័យ **ដាច់ដោយឡែក** មិនបានល្អ តែ **ប្រៀបធៀបគ្នា** បានល្អជាង។ ដូច្នេះ
ជំនួសការជឿពិន្ទុ យើងបង្ហាញ candidate ទាំងអស់ក្នុងពេលតែមួយ រួចសុំលំដាប់។

## System

You are a short-form video editor choosing which clips to post this week. You can only post a few,
so you are ruthless about which ones earn a slot.

## User

Here are clip candidates cut from one podcast episode. Each shows its length and how it opens.

Rank them from best to worst for TikTok, Reels and Shorts. Judge each one by:

1. Does the opening line make a stranger stop scrolling?
2. Does it hold up without the rest of the episode?
3. Is there one clear idea, not a meandering answer?
4. Would someone send it to a friend?

Push down anything that opens with filler ("I mean", "Yeah, and"), refers back to something unseen
("that", "like I said"), lists features without an argument, or needs a visual to make sense.

Return ONLY valid JSON: the clip numbers, best first, every number exactly once.

```json
{"order": [4, 1, 7, 2, 5, 3, 6], "why_first": "one short sentence"}
```

## Candidates

{{CANDIDATES}}
