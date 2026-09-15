---
name: Narration endings that sound cut off
description: Why a voiceover ending feels truncated, how to diagnose it by measuring pitch instead of guessing, and how to splice a replacement line without a voice mismatch.
---

# When a narration ending sounds "cut off"

Three independent causes stack up, and a viewer reports all three as one
complaint. Check each; fixing only one usually does not clear the note.

## 1. Terminal pitch rise

TTS reads a trailing sentence fragment (e.g. "Smarter pricing. Faster
decisions.") with rising intonation, which signals "more is coming". The listener
hears the file end mid-thought.

**Diagnose by measuring, not guessing.** Decode to mono PCM and run an
autocorrelation pitch track over the last ~0.5s of speech. Compare the mean F0 of
the first half against the second half. A rise of more than a few Hz on the final
syllable is the defect. This is worth doing because it also tells you the
speaker's median F0, which you need for cause 3.

**Fix:** a complete declarative clause falls where a fragment rises. Generating
several phrasings and measuring which one actually falls is faster and more
reliable than reasoning about it — TTS intonation does not always follow the
punctuation you would expect.

**Why not fix it with DSP:** the rise lives in the last ~150ms and can be tens of
Hz. Correcting it needs a large local pitch shift, which is audible surgery. A
fresh natural read is safer, especially when you cannot listen to the result.

## 2. A voiceover fade that crosses the final word

An `afade=t=out` on the narration bus scheduled before the last word ends fades
that word to silence. This is easy to introduce when the fade time was chosen
against an earlier, shorter cut of the audio and never revisited.

**How to apply:** the narration fade must start *after* the last word, not near
the end of the timeline. Derive it from measured speech end, never from the
total duration.

## 3. No hold after the last word

Ending the video a fraction of a second after the final syllable reads as a hard
cut regardless of how well the line is delivered. A closing card wants roughly
1.0-1.2s of hold with the music resolving underneath.

**How to apply:** treat the hold as a requirement and let total duration absorb
it. A round duration target is not worth a truncated ending — say so rather than
compressing the read to hit the number.

## Splicing a replacement line without a voice mismatch

When only the closing sentence is replaced, the new voice must match the body.
Median F0 is a good, measurable proxy: generate the line across several candidate
voices, measure each, and pick the closest. A residual gap of a few percent can
be corrected with a global `rubberband=pitch=` ratio, which is inaudible at that
size — unlike a large local shift.

Also match loudness (`volumedetect` mean_volume) — separate TTS renders can
differ by several dB.

Put the splice at a pause that coincides with a visual cut. That is the most
masked moment available.

## Related: stretching a music bed to a new duration

If the film gets longer than the music, a 2-4% `atempo` stretch is inaudible on a
background bed at low level and avoids the loop seam you would otherwise have to
hide.

## Annual In-House Rate Plan tutorial voice

Use the warm British male narration style for this video, but do not speak the
brand name.

**Why:** the product owner restored the British voice, then chose to remove the
spoken brand rather than risk an awkward pronunciation or spacing.

**How to apply:** preserve the British voice when revising this tutorial. Keep
“Modulo” as one word where it appears visually, and align each screen change to
the narration topic instead of holding a separate introduction screen. Format
the main scene headings in title case, and keep the transparent Modulo mark in
the lower-right corner of every scene.
