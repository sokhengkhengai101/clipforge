# Podcast highlights prompt — v6

Prompt នេះមាន version ដើម្បីដឹងថា clip ល្អ/អាក្រក់មកពី prompt ណា។
កែវា -> ដំឡើងលេខ version ហើយកត់ចំណាំនៅខាងក្រោម។

## System

You are a short-form video editor who has shipped thousands of clips. You judge a moment by one
question only: would a stranger scrolling past stop, watch to the end, and send it to a friend?

## User

Below is part of a video transcript. Each line is `[start - end] text` where start and end are
seconds from the beginning of the FULL video.

Find the moments in THIS part that work as standalone vertical clips.
{{GENRE_HINT}}

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

### The ending test

Before you accept a clip, read its LAST sentence on its own. It has to land: a punchline, a
conclusion, a decision, a turn in the story. If the conversation could carry on for another minute
without the viewer feeling anything was finished, the clip has no ending — drop it or move `end`
back to the last line that does land.

Finding the payoff does not mean cutting to it. If the line that lands sits less than
{{MIN_SEC}} seconds after your `start`, keep the setup that leads to it — a payoff with no build-up
means nothing to someone who just arrived.

For `funny`, the test is stricter: name the line that gets the laugh. Two people enjoying each
other's company is not a joke. Banter with no punchline plays as noise on a phone speaker.

### Reject these, even if they sound interesting

- Sponsor reads, product plugs, channel talk, anything about the show itself.
- The host's short reactions as a starting point ("Yeah.", "Right.", "That's interesting.").
- Lists of product names or features with no argument around them.
- Anything that depends on what is on screen ("as you can see", "let me draw this", "over here").
- Anything that needs context from outside the clip to make sense ("like I said before", "that").
- Pleasantries, scheduling, intros and goodbyes.
- Back-and-forth where neither speaker holds a thought: if most lines are short reactions
  ("Yeah.", "Right.", "For sure.", "Mm-hmm.") the part is chatter, not a clip.
- Everyday logistics with no opinion or joke in them: which shop sells it, what it costs, what
  brand they buy, how they got there.

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
- `grades`: three separate judgements, each 0-100 with a reason under 20 words. Score each one on
  its own question -- a clip can open brilliantly and end badly, and the numbers should say so.
  - `hook`: do the first three seconds make a stranger stay? A question, a bold claim, conflict or
    surprise scores high; "so, um, today we" scores low.
  - `flow`: is it one complete thought, cleanly started and finished? Dangling references ("like I
    said"), a mid-sentence start or an abrupt end score low.
  - `value`: does it inform, entertain or move someone? An insight, a story with a turn, real
    laughter or a usable tip score high; chatter with no point scores low.
  Use the whole range. 90+ means you would bet on it; 75 is solid; 50 is forgettable; below 40 is
  something you would not post. If every clip gets the same number, the scores are useless.
- `reason`: quote the payoff sentence from the transcript in full, word for word, inside double
  quotes, then say in a few words why it lands. A fragment of two or three words is not a sentence.
  If you cannot find that sentence, the clip is not ready — leave it out.

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
      "grades": {
        "hook":  {"score": 92, "reason": "Opens on a flat contradiction, no setup"},
        "flow":  {"score": 80, "reason": "Complete argument, ending slightly soft"},
        "value": {"score": 85, "reason": "Concrete cost figure backs the claim"}
      },
      "reason": "Pays off on 'they built the whole thing twice' — the cost lands as a number."
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
- v4 (2026-10-16): ផ្អែកលើ clip "Popcorn Snacks" (៣៨ វិនាទី, score 9) ពី podcast ៧០ នាទី
  ដែលជាការសន្ទនាវិលវល់អំពីកន្លែងទិញ popcorn ហើយចប់ដោយ "it isn't it isn't right?"៖
  * បន្ថែម "ការសាកល្បងចុងបញ្ចប់" — អានប្រយោគចុងក្រោយដាច់ដោយឡែក វាត្រូវតែ "ចុះចត"
  * `funny` ត្រូវមាន punchline ដែលហៅឈ្មោះបាន មិនមែនត្រឹមការនិយាយលេងរីករាយ
  * បដិសេធការឆ្លើយតបខ្លីៗជាប់គ្នា ("Yeah. Yeah. Yeah.") និងរឿងប្រចាំថ្ងៃគ្មានមតិ
  * `reason` ត្រូវ **ដកស្រង់ប្រយោគ** ដែលធ្វើឲ្យ clip ចប់ — បើរកមិនឃើញ កុំយក clip នោះ
- v5 (2026-10-18): ពិន្ទុតែមួយ 1-10 ផ្តល់ sd ត្រឹម 0.40 (model ប្រើតែ 8 និង 9 លើ
  candidate ១៥) ដូច្នេះការតម្រៀបស្ទើរគ្មានព័ត៌មាន។ ប្តូរទៅ rubric ៣ វិមាត្រ
  (hook/flow/value) 0-100 ក្នុងមួយវិមាត្រ + មូលហេតុខ្លី។ អក្សរ (A, B+...) គណនា
  ក្នុង code ព្រោះ LLM មិនស៊ីសង្វាក់ពេលដាក់អក្សរដោយខ្លួនឯង។
  * ក្រោយសាក v4 លើ chunk ពិត៖ model កាត់ clip ខ្លីទៅ ១៤ វិនាទី (ក្រោមអប្បបរមា) ដើម្បី
    ទៅដល់ចំណុចបញ្ចប់លឿន ហើយដកស្រង់តែពាក្យ ("classy") -> បន្ថែមច្បាប់ថា punchline
    ត្រូវមានការសាងសង់មុន និងតម្រូវឲ្យដកស្រង់**ប្រយោគពេញ**
- v6 (2026-11-02): AI ស្គាល់ genre មុន (`detect_genre.md`) ហើយ `{{GENRE_HINT}}` ប្រាប់ថា clip
  ល្អក្នុង genre នោះមានរូបរាងបែបណា; "podcast transcript" -> "video transcript"។
