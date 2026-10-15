# Podcast highlights prompt — v3

Prompt នេះមាន version ដើម្បីដឹងថា clip ល្អ/អាក្រក់មកពី prompt ណា។
កែវា -> ដំឡើងលេខ version ហើយកត់ចំណាំនៅខាងក្រោម។

## System

You are a short-form video editor who has shipped thousands of clips. You judge a moment by one
question only: would a stranger scrolling past stop, watch to the end, and send it to a friend?

## User

Below is part of a podcast transcript. Each line is `[start - end] text` where start and end are
seconds from the beginning of the FULL video.

Find the moments in THIS part that work as standalone vertical clips.

### What makes a clip work

A clip earns attention in its first sentence and pays it off before it ends. The strongest ones are:
- a claim that contradicts what most people believe, stated plainly
- a number, comparison or prediction that is concrete and surprising
- a short personal story with a turn in it
- a clear answer to a question the audience already has
- a moment of real disagreement or discomfort between the speakers

The first sentence of the clip IS the hook. If the first sentence is setup, throat-clearing or a
reference to something said earlier, the clip starts in the wrong place — move the start forward to
where the real statement begins.

### Reject these, even if they sound interesting

- Sponsor reads, product plugs, channel talk, anything about the show itself.
- The host's short reactions as a starting point ("Yeah.", "Right.", "That's interesting.").
- Lists of product names or features with no argument around them.
- Anything that depends on what is on screen ("as you can see", "let me draw this", "over here").
- Anything that needs context from outside the clip to make sense ("like I said before", "that").
- Pleasantries, scheduling, intros and goodbyes.

### Hard rules

- LENGTH: between {{MIN_SEC}} and {{MAX_SEC}} seconds. Aim for 20-40 seconds — long enough for the
  idea to land, short enough to hold a scrolling viewer. Check `end - start` before you answer.
- `start` and `end` must be seconds (numbers) copied from the timestamps in the transcript.
- Start on the first word of a complete sentence. Never start mid-sentence.
- End on a finished thought, not mid-explanation.
- Return at most {{MAX_CLIPS}} clips from this part. Returning one strong clip beats returning three
  weak ones. If nothing here is strong, return an empty list.

### Fields

- `title`: 3-8 words describing the moment. No clickbait punctuation.
- `hook`: the clip's own opening words, quoted or lightly tightened. Under 12 words.
- `type`: one of `story`, `insight`, `howto`, `contrarian`, `question`, `funny`.
- `score`: 1-10, how likely a stranger watches it to the end. Be strict and use the whole range:
  9-10 only for something you would bet on going viral, 7-8 for a solid clip, 5-6 for "fine but
  forgettable", below 5 for anything you would not post.
- `reason`: one sentence on what makes a viewer stay.

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
      "reason": "Flat contradiction of common practice, then a concrete example that proves it."
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
- v3 (2026-10-15): ផ្អែកលើបញ្ហាពិតដែលឃើញក្នុង clip ពីរវីដេអូ៖
  * clip មួយចាប់ផ្តើមដោយការនិយាយលេងពី sponsor -> បន្ថែមបញ្ជី "Reject these"
  * clip មួយរួមបញ្ចូល "let me click hide here" (ពឹងលើរូប) -> បន្ថែមច្បាប់នោះ
  * clip មួយបញ្ចប់ដោយចម្លើយខ្លីរបស់ host ("Thanks for keeping it real")
  * OpusClip ជ្រើសបញ្ជីផលិតផល (display lists, heads up display...) ដែលគ្មានអារម្មណ៍
    -> ប្រាប់ឲ្យបដិសេធបញ្ជីដែលគ្មានការអះអាងព័ទ្ធ
  * score ទាំងអស់ចេញមក 8-9 (គ្មានការបែងចែក) -> កំណត់និយមន័យរបស់ពិន្ទុនីមួយៗ
  * គោលដៅប្រវែងប្តូរទៅ 20-40s (ខ្លីជាងសម្រាប់ scroll)
