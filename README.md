# Personal Learning Hub — V1 Completion Pass

Open `index.html` from the same `KnowledgeHub` folder, browser, and browser profile you already use.

The app remains **local-first** and keeps the existing state key:

`plh-v1-state`

Existing V1/V3 progress is migrated automatically to **state format V4**.

## V1 Complete structure

The top-level navigation remains intentionally simple:

- Home / ホーム
- Learn / 学ぶ
- Quiz / クイズ
- Glossary / 用語集
- Progress / 進捗

No extra top-level app modules were added.

## Completion-pass improvements

### Adaptive learning engine

- Adaptive Smart Review ranks concepts using:
  - overdue review timing
  - recent mistakes
  - current mastery/readiness
  - time since last evidence
  - application evidence
- Same-session missed questions return once in practice mode.
- Misses remain scheduled for later spaced review.
- First-attempt quiz accuracy is tracked separately from retries.
- Recent accuracy is tracked separately from lifetime accuracy.
- Correct-evidence dates use the local calendar date.

### Learning Readiness

A new internal **Learning Readiness / 学習準備度** score is shown for the track and each chapter.

Formula:

- Coverage / 学習範囲: 25%
- Recall / 想起: 30%
- Mastery / 習熟: 30%
- Application / 応用: 15%

This is explicitly a learning-management indicator, **not a guarantee or objective score of workplace performance**.

The Hub identifies weaker chapters and the component currently limiting readiness.

### Assessments

Practice and assessment are now separated.

Practice modes:

- Adaptive Smart Review
- Current Chapter Practice
- Retry Missed
- Random 10

Assessment modes:

- Chapter Assessment — up to 10 questions
- Track Assessment — 20 questions balanced across chapters

Assessment mode hides correct answers until the end and then shows a review of missed questions. Assessment results are stored separately in assessment history.

### Mastery rule

`Mastered / 習得` requires:

- sufficient correct quiz evidence,
- correct evidence across at least 2 different days,
- one completed Application Practice response linked to that concept.

Repeated multiple-choice recognition in one sitting cannot by itself create Mastered status.

### Learn / 学ぶ

- Collapsible chapter TOC
- Lesson search
- Bookmark-only filter
- Explicit lesson completion
- Personal Notes with autosave
- Application Practice with a management-oriented prompt
- Executive Review / 経営前レビュー compact view
- Text-size controls
- Comfortable/wide reading width
- Print current lesson
- Keyboard lesson navigation: `[` previous, `]` next

### Glossary & Reference

Glossary now has three internal modes without adding another top-level page:

- Glossary / 用語集
- Formulas / 計算式
- Frameworks / フレームワーク

Formula reference is generated from glossary entries that contain formulas.

Framework reference is curated into:

- Financial Decision Tools
- Diagnosis & Evidence
- Strategy & Experiments
- Management Decisions
- Execution & Governance

Glossary terms can be saved to My Library.

### Global search

Use the top Search button or `Ctrl/Cmd + K`.

Search now covers:

- lessons
- glossary terms
- aliases/abbreviations
- personal notes
- application-practice responses

### Progress / 進捗

Progress is organized into four internal tabs:

- Overview / 概要
- Mastery / 習熟
- My Library / 自分の記録
- Data & Settings / 保存・設定

Overview includes:

- track readiness
- chapter readiness
- knowledge-gap ranking
- assessment history
- first-attempt and recent accuracy

My Library includes:

- bookmarked lessons
- saved glossary terms
- notes
- application responses
- recently viewed lessons
- recent quiz sessions

### Storage & recovery

Main personal state:

`plh-v1-state`

Snapshot history:

`plh-v1-state-snapshots`

The Hub keeps up to **5 local recovery snapshots** and migrates the previous single-snapshot format when present.

Snapshots are created approximately daily and before import/reset/restore operations.

Important: clearing browser/site data can remove both the main state and local snapshots. JSON export remains the portable backup for moving browsers or computers.

### Exports

- Full state backup as JSON
- Study report as self-contained HTML
- Current lesson via browser Print / PDF

## Intentionally not added

V1 remains intentionally free of:

- login/accounts
- Firebase/cloud database
- social/community features
- streaks, badges, XP
- decorative animation
- AI chat embedded inside the Hub
- collaboration/workspace infrastructure

Those would increase complexity without improving the current learning objective enough to justify them.


## Online / Cross-device architecture

The V1 online build uses:

- GitHub public repository — source/version history
- GitHub Pages — static site hosting
- Firebase Authentication — Google sign-in
- Cloud Firestore — private per-user learning-state sync
- browser localStorage — immediate local/offline copy and recovery snapshots

The public learning content remains in `content.js`. Personal state is not committed to GitHub; after Google sign-in it is written only to the authenticated user's Firestore path under `/users/{uid}/state/current`.

Cloud sync is deliberately additive. The Hub still works without Firebase connectivity, and JSON backup/import remains the portable recovery mechanism.
