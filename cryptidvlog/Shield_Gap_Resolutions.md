# CRYPTID VLOG — SHIELD GAP RESOLUTIONS

## Addendum to Shield System v1.0

February 2026 | Addresses 3 critical gaps identified in post-review audit

---

# OVERVIEW

Three gaps were identified in the Shield System v1.0 that block production readiness:

| Gap | Severity | Status Before | Status After This Document |
|-----|----------|---------------|----------------------------|
| 1. Legal/Compliance (COPPA, GDPR, DMCA, TOS, liability) | Pre-launch blocker | Missing | Resolved — Section A |
| 2. A/B budget conflict ($12/day cap vs. 2 videos × 2 variants) | High | Broken logic | Resolved — Section B |
| 3. Vendor resilience (fal.ai, Anthropic, ElevenLabs, Supabase) | High | No fallbacks | Resolved — Section C |

These sections slot directly into the Shield System as Part 3 extensions (Legal) and Part 7 extensions (Operations). Implementation priority for all three: **Phase 1, Week 1-2** — before any video is generated.

---

# SECTION A: LEGAL SHIELD EXTENSIONS (Gaps in Part 3)

The existing Part 3 covers character IP, voice cloning, and disclosure. Four compliance areas were missing entirely.

---

## A.1 COPPA Compliance (Children's Online Privacy Protection Act)

**Why it matters:** The Yeti/Bigfoot comedy format naturally attracts viewers under 13. If the channel collects any data from users under 13 (comments, analytics with identifiers, ad targeting), COPPA applies and violations carry fines up to $51,744 per violation.

**Platform-Level Compliance (YouTube):**

YouTube handles COPPA for content labeled as "Made for Kids." The decision tree:

```
Is this content primarily made for children?
├── YES → Mark channel as "Made for Kids" in Studio
│         Effect: Comments disabled, personalized ads disabled,
│         no community features. Lower revenue. Appropriate for
│         purely child-directed content.
└── NO  → Mark as "Not Made for Kids"
          Effect: Standard monetization, comments enabled.
          Appropriate for mixed-audience content.
          RISK: If FTC determines content IS child-directed despite
          your label, you face enforcement action.
```

**Decision for Cryptid Vlog:** Mark as **"Not Made for Kids"** with clear content framing as general-audience comedy. Rationale: the humor is adult-adjacent (sarcasm, dry wit, cultural references), not child-directed. This is the same positioning as nature documentary parody channels.

**What this means operationally:**
- Do NOT collect names, emails, or persistent identifiers from users in comments or forms
- Do NOT run retargeting ads to YouTube audiences without age filtering
- DO include the content rating note in channel description: "General audience content. Parental guidance suggested for viewers under 13."
- DO add to the Ideator guardrails: no content specifically designed to appeal to children (no "learn your ABCs with Yeti," no children's songs)

**Data the system collects and its COPPA status:**

| Data Type | Where Stored | COPPA Risk | Action |
|-----------|-------------|------------|--------|
| Video performance analytics | YouTube/TikTok (platform-held) | None — platform responsibility | No action needed |
| Character interaction history | Supabase | None — no user PII | No action needed |
| Scene cost logs | Supabase | None — operational data | No action needed |
| A/B test performance | Supabase | None — aggregate metrics only | No action needed |
| Any email list from newsletter | Email provider (if built) | HIGH — requires consent flow | Add age gate to sign-up form |

**Newsletter age gate (if newsletter is built per Section 4.1):**

```javascript
// newsletter_signup.js

function validateSignup(formData) {
  const { email, birthYear } = formData;
  const age = new Date().getFullYear() - parseInt(birthYear);

  if (age < 13) {
    return {
      success: false,
      message: 'You must be 13 or older to subscribe.'
    };
  }
  if (age < 16 && isEUResident(formData.country)) {
    // GDPR Article 8: 16 in most EU countries (13 with parental consent)
    return {
      success: false,
      message: 'EU residents under 16 require parental consent to subscribe.'
    };
  }

  return { success: true };
}
```

**Quarterly review item:** Check YouTube Analytics audience age report. If under-18 audience exceeds 40%, reassess content strategy and consider "Made for Kids" designation.

---

## A.2 GDPR Compliance (EU General Data Protection Regulation)

**Why it matters:** If any EU residents watch the content, GDPR applies to any personal data collected. Fines up to 4% of global annual revenue or €20M, whichever is higher.

**What personal data does this system touch?**

The production system itself (Supabase, pipelines) collects ZERO user personal data. The risk is in ancillary activities: newsletters, Discord communities, comment engagement.

**Data Inventory:**

| Activity | Personal Data | Lawful Basis | Retention | Deletion Process |
|----------|--------------|--------------|-----------|-----------------|
| YouTube/TikTok analytics | Anonymized by platform | Platform's responsibility | Platform-held | Request via platform |
| Discord community | Username, messages | Legitimate interest / consent | Discord's policy | Discord account deletion |
| Newsletter | Email address | Consent (opt-in) | Until unsubscribe | Automated on unsubscribe |
| Support emails | Email, name | Contract | 2 years | Manual deletion on request |

**Required disclosures:**

Add a simple Privacy Notice linked from all owned platforms (newsletter footer, Discord server info, YouTube about section). Minimum content:

```
Privacy Notice — Cryptid Vlog

We collect email addresses for newsletter subscribers (with consent).
We do not sell personal data.
EU residents have the right to access, correct, or delete their data.
To exercise these rights: [contact email]
Data processor: [email provider name]
```

**GDPR deletion workflow:**

```javascript
// gdpr_deletion.js — run when deletion request received

async function processGDPRDeletion(email) {
  // 1. Remove from email list
  await emailProvider.deleteSubscriber(email);

  // 2. Delete from any internal logs that captured email
  await supabase.from('newsletter_signups')
    .delete()
    .eq('email', email);

  // 3. Log the deletion for compliance record (retain 90 days)
  await supabase.from('gdpr_deletion_log').insert({
    email_hash: hashEmail(email),  // Hash only — not the email itself
    deleted_at: new Date().toISOString(),
    requested_by: 'data_subject'
  });

  // 4. Confirm deletion to requester
  console.log(`GDPR deletion complete for: ${email}`);
}
```

**Practical scope for Cryptid Vlog at launch:** If the channel is small (under 10K subscribers), GDPR enforcement risk is near-zero. The actions above are lightweight and establish good practices for scale. The key point: never build any user-tracking or data-collection feature without revisiting this section first.

---

## A.3 DMCA Safe Harbor and Takedown Protocol

**Why it matters:** If a generated video accidentally contains content that resembles copyrighted material (a character, a song, a specific scene reconstruction), the rights holder can issue a DMCA takedown. Without a defined protocol, this causes channel disruption and potential strikes.

**DMCA Strike Risk for AI-Generated Content:**

| Risk Source | Likelihood | Example |
|-------------|-----------|---------|
| Music in generated audio | Medium | Veo generates background music resembling a copyrighted song |
| Character resemblance | Low | Yeti scene resembles specific copyrighted shot from a film |
| Dialogue resemblance | Very Low | Generated dialogue quotes copyrighted screenplay |
| Background art | Low | Generated environment resembles copyrighted concept art |

**Pre-emptive Mitigations:**

1. **No background music from Veo audio** — Strip Veo-generated audio and replace with royalty-free music from licensed sources (Epidemix Sounds, Artlist, or silence). This eliminates the highest-risk DMCA vector.

```javascript
// audio_pipeline.js

async function assembleAudio(scenePaths, episodeId) {
  // Step 1: Strip ALL Veo-generated audio
  for (const scenePath of scenePaths) {
    execSync(`ffmpeg -i ${scenePath} -an ${scenePath.replace('.mp4', '_silent.mp4')}`);
  }

  // Step 2: Select licensed background track
  const track = await selectLicensedTrack(episodeId);  // From pre-licensed library

  // Step 3: Mix character voice (ElevenLabs synthetic) + licensed music
  // Character voice is fully synthetic — zero DMCA risk
  // Licensed track is pre-cleared — zero DMCA risk
}
```

2. **Add Gate 4 DMCA check for visual content:** Claude vision reviews assembled video for obvious IP resemblances before upload.

```javascript
// dmca_visual_check.js — added to Gate 4

async function checkDMCAVisual(videoPath) {
  const frames = extractKeyframes(videoPath, 5);  // 5 representative frames

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Review these video frames for potential copyright or trademark issues.

Flag if you see:
- Characters that strongly resemble specific copyrighted characters (not generic cryptids)
- Logos, trademarks, or brand identifiers
- Specific copyrighted locations reproduced in detail (e.g., Hogwarts, Disney parks)
- Text that reproduces copyrighted material

Respond with JSON: {"dmca_risk": "none|low|medium|high", "flags": [], "recommendation": "proceed|review|reject"}` },
        ...frames.map(f => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f } }))
      ]
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

**Takedown Response Protocol (when a strike occurs):**

```
DMCA Strike Response Procedure

Step 1 (within 24 hours):
  - Do not dispute immediately — review the claim
  - Identify the specific video and flagged content
  - Check if the claim is automated (Content ID) or manual (attorney letter)

Step 2 — Automated Content ID match:
  - If music: confirm audio replacement was applied; if not, replace and re-upload
  - If visual: review the flagged segment; if legitimate, edit out and re-upload
  - If spurious (common with AI content): file counter-notification
    → Counter-notification window: 10-14 business days for claimant to file lawsuit
    → If no lawsuit filed, YouTube restores the video

Step 3 — Manual DMCA notice (attorney letter):
  - Do not counter-notify without legal review
  - Consult the IP attorney retained in Part 3.1
  - Options: modify content, negotiate license, counter-notify if fair use applies

Step 4 — Strike accumulation management:
  - 1 strike: No action needed, monitor
  - 2 strikes: Review all content for similar patterns; suspend A/B testing
  - 3 strikes: Channel termination risk; activate backup account; consult attorney
```

---

## A.4 Platform TOS Compliance Review

**Why it matters:** YouTube and TikTok's policies on AI-generated content are actively evolving. Violating TOS is grounds for channel termination without DMCA involvement. This is a higher day-to-day risk than formal legal action.

**Current Policy Status (February 2026):**

| Platform | AI Content Policy | Disclosure Required? | Labeling System |
|----------|------------------|---------------------|-----------------|
| YouTube | Permitted; disclosure required for "realistic" AI content | Yes — in upload flow | "Altered/synthetic content" label |
| TikTok | Permitted; disclosure required | Yes — AIGC label mandatory | Automatic label system |
| Instagram | Permitted; disclosure encouraged | Recommended | "AI info" tag |

**Compliance actions (already partially covered by Part 3.3 disclosure framework):**

YouTube-specific additions to Gate 7 pipeline:

```javascript
// youtube_upload.js — extend existing uploader

async function uploadToYouTube(videoPath, metadata) {
  await youtube.videos.insert({
    part: ['snippet', 'status', 'selfDeclaredMadeForKids'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description + '\n\n⚠️ This video contains AI-generated content.',
        tags: [...metadata.tags, 'AI generated', 'artificial intelligence'],
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,  // Per A.1 decision
        // YouTube's AI disclosure field (added 2024):
        containsSyntheticMedia: true,
      }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
}
```

TikTok-specific — AIGC label must be set at upload:

```javascript
// tiktok_upload.js

async function uploadToTikTok(videoPath, metadata) {
  await tiktok.video.upload({
    video: videoPath,
    caption: metadata.caption,
    // TikTok AIGC disclosure (mandatory per TikTok policy):
    aigc_description: 'ai_generated',  // Triggers automatic "AI-generated" label
  });
}
```

**Quarterly TOS Review checklist (add to Operations Shield):**

```
□ Review YouTube Creator Help — AI content policies page
□ Review TikTok Creator Academy — AIGC label requirements
□ Check for new state/national AI disclosure laws (EU AI Act updates, US state laws)
□ Verify disclosure watermark still meets current platform specs
□ Update legal counsel if any policy material change found
```

---

## A.5 Liability Allocation Framework

**Why it matters:** If Veo generates defamatory content, an infringing character, or content that causes harm, the question "who is liable — you, fal.ai, or Anthropic?" determines your legal exposure.

**Vendor liability positions (as of February 2026):**

| Vendor | Their Position (TOS-stated) | Your Exposure |
|--------|----------------------------|---------------|
| fal.ai | User is responsible for outputs; fal.ai provides infrastructure only | You bear liability for what Veo generates |
| Anthropic | User responsible for Claude's outputs in production systems | You bear liability for Claude analysis/decisions |
| ElevenLabs | User responsible for generated audio; no cloning without consent | You bear liability for voice outputs |

**In practice:** You are the publisher. All vendor TOS place output liability on the operator (you), not the infrastructure provider. This is standard across AI platforms.

**Practical protections:**

1. **Production liability insurance** — General liability policy that includes AI-generated content. Seek a media liability or E&O (Errors & Omissions) rider. Estimated cost: $500-1,500/year for a small creator operation. Contact: Athos Insurance, Hiscox, or a media-specialized broker.

2. **Content review as legal shield** — The human review queue (existing in the pipeline) is your primary liability defense. If a video is reviewed and approved by a human before upload, you have demonstrated reasonable care. Document the review process.

3. **Quick-removal capability** — Add a one-command emergency takedown:

```javascript
// emergency_takedown.js

async function emergencyTakedown(videoId, reason) {
  // 1. Set video to private on all platforms immediately
  await youtube.videos.update({
    part: ['status'],
    requestBody: { id: videoId, status: { privacyStatus: 'private' } }
  });
  await tiktok.video.setPrivacy(videoId, 'private');

  // 2. Log the takedown
  await supabase.from('takedown_log').insert({
    video_id: videoId,
    reason: reason,
    actioned_at: new Date().toISOString(),
    actioned_by: 'operator'
  });

  // 3. Alert operator
  await telegram.sendMessage(CHAT_ID, `🚨 Emergency takedown: ${videoId} — ${reason}`);

  console.log(`Video ${videoId} set to private. Review before re-publishing.`);
}
```

4. **Attorney on retainer** — Budget $200-500/month for a media/IP attorney on retainer. The character IP review (Part 3.1) should be this attorney's first engagement.

---

# SECTION B: A/B BUDGET CONFLICT RESOLUTION

## The Conflict Explained

The Shield System v1.0 contains two conflicting specifications:

**Spec 1 (Section 7.1):**
```javascript
const DAILY_BUDGET = {
  hard_cap: 75,
  ab_testing_cap: 12,   // $12/day total for A/B testing
};
```

**Spec 2 (Section 5.3):**
```javascript
const AB_LIMITS = {
  max_variants_per_video: 2,
};
// With 2 videos/day (Section 7.4) and 2 variants each:
// 2 videos × 2 variants × ~$4/variant = $16/day A/B spend
// → Exceeds the $12/day cap by $4
```

**The result:** The cap is violated every day that both videos run A/B testing. The "skip if budget tight" logic (skip if >80% of daily budget spent) only kicks in late in the day and doesn't solve the structural mismatch.

---

## Resolution: Tiered A/B Strategy with Priority Selector

Rather than a flat A/B cap, replace with a priority-based system that always stays within budget by deciding intelligently WHICH video gets A/B testing on any given day.

### B.1 Revised A/B Budget Constants

```javascript
// ab_cost_cap.js — REVISED

const AB_LIMITS = {
  // Per-video
  max_variants_per_video: 2,
  max_ab_cost_per_video: 8.00,        // Raised from implicit ~$6 to explicit $8
                                       // Accounts for $4/variant + retry margin

  // Daily totals
  max_ab_budget_daily: 16.00,         // RAISED from $12 → $16 (2 videos × $8)

  // Override: kill-switch
  skip_ab_if_daily_spend_exceeds: 55, // Skip ALL A/B if base video costs have
                                       // already consumed $55 of the $75 cap
                                       // (leaves $20 buffer for retries + cleanup)
};

// Daily budget revised to reflect actual math:
const DAILY_BUDGET = {
  hard_cap: 75,
  warning_at: 60,
  target: 45,                          // REVISED: was 35, actual steady-state is ~$40-48
  ab_testing_cap: 16,                  // REVISED: was 12
  character_consistency_cap: 2,
  retry_reserve: 8,                    // NEW: explicit budget allocation for retries
};
```

**How the new math works:**

| Scenario | Cost Breakdown | Total | Within Budget? |
|----------|---------------|-------|----------------|
| 2 videos, both A/B | 2×$15 base + 2×$8 A/B | $46 | ✓ ($75 cap) |
| 2 videos, both A/B + 2 retries | $46 + $8 retry | $54 | ✓ ($75 cap) |
| 2 videos, both A/B + 4 retries | $46 + $16 retry | $62 | ✓ (warning at $60) |
| Worst case: all retries + full A/B | $46 + $25 retry | $71 | ✓ (under $75) |

### B.2 Priority Selector: Which Video Gets A/B?

On days where the budget is tighter than expected (e.g., retry-heavy day), use a priority selector instead of arbitrarily skipping:

```javascript
// ab_priority_selector.js

async function selectABCandidates(videos, dailySpendSoFar) {
  const remainingBudget = DAILY_BUDGET.hard_cap - dailySpendSoFar;
  const abBudgetAvailable = Math.min(
    AB_LIMITS.max_ab_budget_daily,
    remainingBudget - DAILY_BUDGET.retry_reserve  // Always protect retry reserve
  );

  if (abBudgetAvailable < AB_LIMITS.max_ab_cost_per_video) {
    // Not enough budget for even one A/B test
    return { candidates: [], reason: 'Insufficient daily budget for A/B testing' };
  }

  // Score each video's A/B priority
  const scored = videos.map(video => ({
    video,
    score: calculateABPriority(video)
  })).sort((a, b) => b.score - a.score);

  // Select as many as budget allows, highest priority first
  const candidates = [];
  let budgetUsed = 0;
  for (const { video } of scored) {
    if (budgetUsed + AB_LIMITS.max_ab_cost_per_video <= abBudgetAvailable) {
      candidates.push(video);
      budgetUsed += AB_LIMITS.max_ab_cost_per_video;
    }
  }

  return { candidates, budgetUsed, budgetAvailable: abBudgetAvailable };
}

function calculateABPriority(video) {
  // Higher score = higher A/B priority
  let score = 0;

  // New concept/archetype (hasn't been tested before) → higher priority
  if (!video.archetype_tested_before) score += 30;

  // Holiday or trending topic → higher priority
  if (video.has_trending_hook) score += 25;

  // First video of series episode → higher priority (hooks matter more)
  if (video.is_series_opener) score += 20;

  // Ideator confidence score (if Ideator rated the concept highly)
  score += video.ideator_confidence * 0.25;  // 0-100 → adds 0-25 points

  return score;
}
```

### B.3 A/B Rotation Schedule (Fallback)

If the priority selector is not yet built, use this simple rotation schedule as an interim rule:

```
Monday:    Video 1 gets A/B, Video 2 does not
Tuesday:   Video 2 gets A/B, Video 1 does not
Wednesday: Both get A/B (if base costs were low — check spend at 6pm)
Thursday:  Video 1 gets A/B, Video 2 does not
Friday:    Video 2 gets A/B, Video 1 does not
Saturday:  Both get A/B (weekend — lower API demand, lower cost risk)
Sunday:    No A/B testing (buffer generation day — focus on queue)
```

This limits A/B to 1 video/day on 4 days, 2 videos/day on 2 days, and 0 on Sunday. Weekly A/B cost: (4 × $8) + (2 × $16) = $64/week = $9.14/day average. Well within the $16/day revised cap.

### B.4 Retry Cost Reserve (New — was missing from v1.0)

The original document had no explicit retry budget. This caused the budget math to be optimistic. Formalize it:

```javascript
// retry_manager.js

const RETRY_POLICY = {
  max_retries_per_scene: 2,     // If a scene fails consistency gate twice, abort this scene
  max_retries_per_video: 4,     // If a video accumulates 4 scene retries, abort and requeue
  retry_cost_estimate: 4.00,    // Assume each retry costs same as original generation
  daily_retry_reserve: 8.00,    // Always hold $8 in daily budget for retries
};

async function retryScene(sceneId, reason) {
  const retriesUsed = await getRetryCount(sceneId);

  if (retriesUsed >= RETRY_POLICY.max_retries_per_scene) {
    await telegram.sendMessage(CHAT_ID,
      `⚠️ Scene ${sceneId} failed ${retriesUsed} times (${reason}). Skipping scene — video will be shorter.`
    );
    return { skipped: true };
  }

  // Check retry reserve
  const todayRetrySpend = await getDailyRetrySpend();
  if (todayRetrySpend >= RETRY_POLICY.daily_retry_reserve) {
    await telegram.sendMessage(CHAT_ID,
      `⚠️ Daily retry reserve exhausted ($${todayRetrySpend.toFixed(2)}). Queuing ${sceneId} for tomorrow.`
    );
    return { queued: true };
  }

  // Proceed with retry
  return { proceed: true };
}
```

---

# SECTION C: VENDOR RESILIENCE FRAMEWORK

## The Problem

The system depends on 5 external vendors. None have documented fallbacks:

| Vendor | Role | Downtime Impact | Historical Reliability |
|--------|------|----------------|----------------------|
| fal.ai (Veo 3.1) | Video generation | Pipeline stops entirely | ~99% (API platform) |
| Anthropic (Claude) | Vision, consistency, content gate | All AI gates bypass | ~99.9% |
| ElevenLabs | Voice synthesis | Silent characters | ~99.5% |
| Supabase | Database + storage | All tracking stops | ~99.9% |
| Blotato | Publishing | Content doesn't post | ~98% |

A "five nines" compound system availability: 0.99 × 0.999 × 0.995 × 0.999 × 0.98 = **~96.3% uptime**. That's ~13 days of cumulative downtime per year, with many of those days causing complete pipeline failure.

The 2-day content buffer handles most outages. But any single-vendor outage exceeding 48 hours (which happens 2-3× per year across these platforms) drains the buffer and stops publishing.

---

## C.1 fal.ai / Veo 3.1 Fallback

Veo 3.1 is the hardest to replace — it's the core generation engine. Two fallback tiers:

**Tier 1 Fallback (Veo on different infrastructure):**
If fal.ai is down but Veo 3.1 is available elsewhere, route to an alternate API provider hosting Veo.

```javascript
// video_generator.js — with fallback routing

const VIDEO_PROVIDERS = [
  {
    name: 'fal.ai',
    endpoint: 'https://fal.run/fal-ai/veo3',
    apiKey: process.env.FAL_API_KEY,
    model: 'veo-3.1',
    priority: 1,
  },
  {
    name: 'replicate',
    endpoint: 'https://api.replicate.com/v1/predictions',
    apiKey: process.env.REPLICATE_API_KEY,
    model: 'google/veo-3.1',   // If Replicate carries Veo; check availability
    priority: 2,
  },
];

async function generateVideo(prompt, options, attempt = 0) {
  const provider = VIDEO_PROVIDERS[attempt];
  if (!provider) throw new Error('All video providers failed');

  try {
    const result = await callProvider(provider, prompt, options);
    if (attempt > 0) {
      await telegram.sendMessage(CHAT_ID,
        `ℹ️ Video generated via fallback provider: ${provider.name}`
      );
    }
    return result;
  } catch (err) {
    console.error(`Provider ${provider.name} failed: ${err.message}`);
    await wait(10000);  // 10s before trying next provider
    return generateVideo(prompt, options, attempt + 1);
  }
}
```

**Tier 2 Fallback (Image slideshow format):**
If video generation is completely unavailable, fall back to image-based content using Flux or DALL-E. Generate 5 still images + narration audio + pan/zoom FFmpeg animation. Output looks like a motion comic rather than video. This is transparent to viewers when disclosed in the video description.

```javascript
// slideshow_fallback.js

async function generateSlideshow(visualDNA, script, episodeId) {
  const DATE = new Date().toISOString().split('T')[0].replace(/-/g, '');

  // Generate 5 images via Flux (or DALL-E as secondary)
  const images = [];
  for (let i = 0; i < 5; i++) {
    const imagePrompt = buildSceneImagePrompt(visualDNA, script.scenes[i]);
    const image = await generateImage(imagePrompt);  // Flux or DALL-E
    const path = `/tmp/daf-output/slide_${i}_${DATE}.jpg`;
    fs.writeFileSync(path, Buffer.from(image, 'base64'));
    images.push(path);
  }

  // Animate with Ken Burns effect (pan + zoom)
  for (let i = 0; i < images.length; i++) {
    execSync(`ffmpeg -loop 1 -i ${images[i]} -t 6 \
      -vf "scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':d=180:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',scale=1080:1920" \
      -c:v libx264 -r 30 /tmp/slide_clip_${i}.mp4`);
  }

  // Concatenate slides
  execSync(`ffmpeg -f concat -i /tmp/slide_list.txt -c copy /tmp/assembled_slideshow.mp4`);

  await telegram.sendMessage(CHAT_ID,
    `⚠️ Video generation unavailable. Slideshow fallback used for episode ${episodeId}.`
  );

  return `/tmp/assembled_slideshow.mp4`;
}
```

**Activation logic:**

```javascript
async function generateWithFallback(prompt, options, episodeId) {
  try {
    return await generateVideo(prompt, options);   // Try all video providers
  } catch (err) {
    console.error('All video providers failed. Activating slideshow fallback.');
    await telegram.sendMessage(CHAT_ID, '🚨 All video providers down. Using slideshow fallback.');
    return await generateSlideshow(options.visualDNA, options.script, episodeId);
  }
}
```

---

## C.2 Anthropic / Claude Fallback

Claude is used for: consistency scoring (Gate 1), IP check, scene continuity (Gate 2), content policy review (Gate 4), memory integrity (Part 5.1), and DMCA visual check (Section A.3).

**Fallback: OpenAI GPT-4o (vision-capable)**

GPT-4o has vision capability and handles the same prompts. Consistency scoring prompt outputs are format-identical (JSON). The quality may be slightly different but functional.

```javascript
// ai_client.js — unified client with fallback

async function runVisionAnalysis(prompt, images, maxTokens = 500) {
  // Try Anthropic first
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map(img => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: img }
          }))
        ]
      }]
    });
    return response.content[0].text;

  } catch (err) {
    if (err.status === 529 || err.message.includes('overloaded')) {
      // Anthropic overloaded — fall back to GPT-4o
      console.warn('Anthropic unavailable. Falling back to GPT-4o.');
      await telegram.sendMessage(CHAT_ID, 'ℹ️ Claude unavailable — using GPT-4o fallback for AI gates.');

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map(img => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${img}` }
            }))
          ]
        }]
      });
      return response.choices[0].message.content;
    }
    throw err;
  }
}
```

**Gate behavior during Claude outage:**
- Gate 1 (Consistency): Run with GPT-4o. Scores may differ slightly — acceptable.
- Gate 2 (Continuity): Run with GPT-4o. Same prompt format.
- Gate 4 (Content Policy): Run with GPT-4o. Acceptable — conservative safety reviews.
- Gate 3 (Face Detection): Uses a local model (MediaPipe/OpenCV), not Claude. No fallback needed.
- Memory Integrity: Run with GPT-4o. Same JSON output format.

---

## C.3 ElevenLabs Fallback

ElevenLabs synthesizes character voices. Alternatives:

```javascript
// voice_synthesizer.js — with fallback

const VOICE_PROVIDERS = [
  {
    name: 'elevenlabs',
    client: elevenlabs,
    voiceIds: {
      yeti: process.env.ELEVENLABS_YETI_VOICE_ID,
      bigfoot: process.env.ELEVENLABS_BIGFOOT_VOICE_ID,
    }
  },
  {
    name: 'cartesia',  // Alternative: similar quality, independent infrastructure
    client: cartesia,
    voiceIds: {
      yeti: process.env.CARTESIA_YETI_VOICE_ID,
      bigfoot: process.env.CARTESIA_BIGFOOT_VOICE_ID,
    }
  },
  {
    name: 'openai-tts',  // Tertiary: OpenAI TTS — less character-specific but available
    client: openai,
    voiceIds: {
      yeti: 'nova',     // Closest match for female character
      bigfoot: 'onyx',  // Closest match for male character
    }
  }
];

async function synthesizeVoice(text, character, attempt = 0) {
  const provider = VOICE_PROVIDERS[attempt];
  if (!provider) throw new Error('All voice providers failed');

  try {
    return await provider.client.synthesize(text, provider.voiceIds[character]);
  } catch (err) {
    console.warn(`Voice provider ${provider.name} failed: ${err.message}`);
    return synthesizeVoice(text, character, attempt + 1);
  }
}
```

**Voice consistency impact during fallback:** OpenAI TTS will produce a noticeably different voice than the character's ElevenLabs voice. For extended outages (>1 day), hold videos using OpenAI TTS in the human review queue rather than auto-publishing. Label them "B-roll" in the publishing queue to avoid inconsistency going live without review.

**Setup requirement:** Pre-configure character voices on Cartesia before launch. Cost: minimal (Cartesia has a free tier). This is a one-time setup task to add to Phase 1.

---

## C.4 Supabase Fallback

Supabase provides the database (PostgreSQL) and file storage. Its two roles need separate fallback strategies.

**Database fallback:**

```javascript
// db_client.js — with local SQLite fallback

import Database from 'better-sqlite3';

let localDb = null;

async function query(table, operation, data) {
  try {
    // Try Supabase
    return await supabase.from(table)[operation](data);
  } catch (err) {
    if (isSupabaseDown(err)) {
      console.warn('Supabase unavailable. Using local SQLite fallback.');

      // Initialize local SQLite if not already
      if (!localDb) {
        localDb = new Database('/data/local_fallback.db');
        initLocalSchema(localDb);
      }

      // Write-through to local
      return localDbOperation(localDb, table, operation, data);
    }
    throw err;
  }
}

// On Supabase recovery: sync local writes back
async function syncLocalToSupabase() {
  if (!localDb) return;
  const pending = localDb.prepare("SELECT * FROM pending_sync").all();
  for (const record of pending) {
    await supabase.from(record.table).upsert(record.data);
    localDb.prepare("DELETE FROM pending_sync WHERE id = ?").run(record.id);
  }
  console.log(`Synced ${pending.length} local records to Supabase.`);
}
```

**Storage fallback:**

```javascript
// storage_client.js

async function storeFile(filePath, destination) {
  try {
    return await supabase.storage.from('videos').upload(destination, fs.createReadStream(filePath));
  } catch (err) {
    if (isSupabaseDown(err)) {
      // Fall back to local disk — DO NOT delete source file
      const localBackup = `/data/supabase_backup/${destination}`;
      fs.mkdirSync(path.dirname(localBackup), { recursive: true });
      fs.copyFileSync(filePath, localBackup);
      console.warn(`Supabase storage down. File backed up locally: ${localBackup}`);
      // Add to sync queue
      localDb.prepare("INSERT INTO storage_sync_queue (path, destination) VALUES (?, ?)").run(localBackup, destination);
      return { local: true, path: localBackup };
    }
    throw err;
  }
}
```

---

## C.5 Extended Content Buffer Policy

With fallbacks documented, the buffer policy can be smarter than a flat "2-day" rule:

```javascript
// buffer_manager.js — revised

const BUFFER_POLICY = {
  normal_minimum_days: 2,      // Target minimum under normal conditions
  vendor_outage_days: 5,       // Trigger extra generation if ANY vendor is degraded
  warning_threshold_days: 3,   // Alert at 3 days (previously 2)
  emergency_threshold_days: 1, // Emergency: publish at reduced cadence
};

async function assessBuffer() {
  const approved = await supabase.from('videos')
    .select('id').eq('approval_status', 'approved').is('youtube_post_id', null);

  const bufferDays = approved.data.length / 2;
  const vendorStatus = await checkVendorHealth();  // See C.6

  const minimumRequired = vendorStatus.anyDegraded
    ? BUFFER_POLICY.vendor_outage_days
    : BUFFER_POLICY.normal_minimum_days;

  if (bufferDays < BUFFER_POLICY.emergency_threshold_days) {
    await telegram.sendMessage(CHAT_ID,
      `🚨 Buffer CRITICAL: ${bufferDays.toFixed(1)} days. Reducing to 1 post/day until replenished.`
    );
    return { action: 'reduce_cadence', bufferDays };
  }

  if (bufferDays < minimumRequired) {
    await telegram.sendMessage(CHAT_ID,
      `⚠️ Buffer low: ${bufferDays.toFixed(1)} days (minimum: ${minimumRequired}). Generating extra content.`
    );
    return { action: 'generate_extra', bufferDays };
  }

  return { action: 'normal', bufferDays };
}
```

---

## C.6 Vendor Health Monitor

Add a lightweight health check that runs every 30 minutes and updates vendor status:

```javascript
// vendor_health.js

const VENDORS = [
  { name: 'fal.ai',      healthUrl: 'https://status.fal.ai/api/v2/status.json' },
  { name: 'anthropic',   healthUrl: 'https://status.anthropic.com/api/v2/status.json' },
  { name: 'elevenlabs',  healthUrl: 'https://status.elevenlabs.io/api/v2/status.json' },
  { name: 'supabase',    healthUrl: 'https://status.supabase.com/api/v2/status.json' },
];

async function checkVendorHealth() {
  const results = await Promise.allSettled(
    VENDORS.map(async vendor => {
      const res = await fetch(vendor.healthUrl, { timeout: 5000 });
      const data = await res.json();
      return {
        name: vendor.name,
        status: data.status?.indicator,   // 'none' | 'minor' | 'major' | 'critical'
        degraded: data.status?.indicator !== 'none',
      };
    })
  );

  const statuses = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { name: VENDORS[i].name, status: 'unknown', degraded: true }
  );

  const anyDegraded = statuses.some(s => s.degraded);

  // Alert if any vendor is degraded
  const degraded = statuses.filter(s => s.degraded);
  if (degraded.length > 0) {
    await telegram.sendMessage(CHAT_ID,
      `⚠️ Vendor degradation detected: ${degraded.map(d => `${d.name} (${d.status})`).join(', ')}`
    );
  }

  // Store for buffer assessment
  await supabase.from('vendor_health_log').insert({
    statuses,
    any_degraded: anyDegraded,
    checked_at: new Date().toISOString()
  });

  return { statuses, anyDegraded };
}

// Schedule: every 30 minutes
setInterval(checkVendorHealth, 30 * 60 * 1000);
```

---

## C.7 Vendor Resilience Summary

| Vendor | Tier 1 Fallback | Tier 2 Fallback | Max Tolerated Outage |
|--------|----------------|----------------|---------------------|
| fal.ai (Veo) | Replicate (Veo) | Slideshow (Flux/DALL-E) | 48h before slideshows publish |
| Anthropic (Claude) | GPT-4o | Gate bypass with human review flag | Indefinite with human review |
| ElevenLabs | Cartesia | OpenAI TTS (held for review) | 24h before TTS switch with review |
| Supabase DB | Local SQLite + sync queue | — | Indefinite (sync on recovery) |
| Supabase Storage | Local disk + sync queue | — | Indefinite (sync on recovery) |
| Blotato | Manual YouTube upload | — | 24h (human posts manually) |

---

# UPDATED IMPLEMENTATION PRIORITY

These items should be inserted into the existing implementation schedule:

| Priority | Item | Phase | Reason |
|----------|------|-------|--------|
| 0 (before Phase 1) | Legal/compliance review (attorney, insurance quote) | Pre-Phase 1 | Cannot generate commercial content without this |
| 0 (before Phase 1) | Cartesia voice account setup + character voice creation | Pre-Phase 1 | Takes time to configure; cheap to do early |
| 0 (before Phase 1) | Revised A/B constants deployed | Pre-Phase 1 | Fix the budget logic before any generation |
| 1a | COPPA/GDPR privacy notice published | Phase 1 Week 1 | Before any audience-building activity |
| 1b | Platform TOS disclosure fields added to upload scripts | Phase 1 Week 1 | Before first upload |
| 1c | Emergency takedown script | Phase 1 Week 2 | Before first public video |
| 2a | Vendor health monitor | Phase 2 Week 3 | Before production scale |
| 2b | AI client fallback (GPT-4o) | Phase 2 Week 3 | Before production scale |
| 2c | Voice synthesizer fallback (Cartesia → OpenAI TTS) | Phase 2 Week 3 | Before production scale |
| 3a | Supabase DB + storage fallback | Phase 3 Week 5 | Before multi-video/day cadence |
| 3b | Slideshow fallback pipeline | Phase 3 Week 5 | Before multi-video/day cadence |
| 3c | Extended buffer policy (5-day during vendor outage) | Phase 3 Week 5 | Before multi-video/day cadence |
| 4a | GDPR deletion workflow | Phase 4 Week 8 | Before any newsletter/email list |
| 4b | A/B priority selector | Phase 4 Week 9 | When A/B testing is implemented |
| 4c | DMCA visual gate + takedown protocol | Phase 4 Week 9 | Before monetization enabled |

---

# RESOLUTION CHECKLIST

Use this as a sign-off gate before Phase 1 begins:

**Legal (Section A)**
- [ ] Privacy Notice published (YouTube About, Discord, newsletter footer)
- [ ] COPPA decision documented: "Not Made for Kids" — rationale on file
- [ ] GDPR deletion workflow implemented (or email provider handles it)
- [ ] Platform TOS `containsSyntheticMedia: true` added to upload scripts
- [ ] DMCA audio strip confirmed (no Veo-generated audio in final videos)
- [ ] Emergency takedown script deployed and tested
- [ ] Attorney reviewed: character IP, voice synthesis, content liability
- [ ] Insurance quote obtained for media liability E&O rider

**Budget (Section B)**
- [ ] `ab_testing_cap` updated from $12 → $16 in codebase
- [ ] `retry_reserve: 8` added to DAILY_BUDGET constants
- [ ] `target` updated from $35 → $45 in DAILY_BUDGET
- [ ] A/B rotation schedule documented and communicated to operator
- [ ] Retry manager deployed with per-scene and per-video limits

**Vendor Resilience (Section C)**
- [ ] Cartesia account created; Yeti and Bigfoot voice IDs configured
- [ ] Replicate account active; Veo endpoint tested
- [ ] OpenAI account active with GPT-4o and TTS access confirmed
- [ ] AI client fallback (Claude → GPT-4o) deployed and tested
- [ ] Voice fallback chain (ElevenLabs → Cartesia → OpenAI TTS) deployed
- [ ] Supabase local SQLite fallback deployed
- [ ] Vendor health monitor running on 30-minute schedule
- [ ] Slideshow fallback pipeline built and smoke-tested
- [ ] Extended buffer policy (5-day during degradation) active

---

*Shield Gap Resolutions v1.0 — Companion to Shield System v1.0*
*Status: Ready for Phase 1 implementation*
