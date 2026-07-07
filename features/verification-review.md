# Feature Specification: Verification and Review

## What this file is for

This file defines the audit verification workflow: sample run, unverified output, tester/reviewer fields, pass/fail, amend review, verified status, and evidence review.

## When to read this file

Read this file when building or changing:

- Version Verification tab or panel.
- Sample run flow.
- Tester/reviewer assignment.
- Pass/fail/amend review actions.
- Verified status display.
- Review evidence capture.

## When not to read this file

Do not read this file for generic workflow execution internals, template browsing, or catalog search except where status display is involved.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Verification is an audit governance process, not just a UI label.
2. Do not mark a version verified without recorded evidence.
3. Preserve reviewer/tester identity, timestamps, and decision rationale.
4. Verified versions must become immutable.
5. Add tests for pass, fail, amend, and evidence requirements.

---

# 1. Feature summary

Before a workflow version becomes trusted, it must be tested and reviewed. Verification creates confidence that the workflow logic, parameters, and outputs are correct.

# 2. MVP verification flow

1. Builder submits draft version for review.
2. Tester performs or records a sample run.
3. Reviewer inspects output and configuration.
4. Reviewer chooses Pass, Fail, or Amend Review.
5. Passed version becomes Verified.
6. Verified version may be activated.

# 3. MVP user stories

## 3.1 Submit for review

Acceptance criteria:

- User can submit draft version for verification.
- App validates workflow before submission.
- Required metadata, inputs, and parameters must be complete.
- Version status becomes In Review.

## 3.2 Perform sample run

Acceptance criteria:

- User can run sample verification execution.
- Sample run is linked to the verification record.
- Unverified output is displayed for review.
- Failed sample run blocks verification pass.

## 3.3 Record tester and reviewer

Acceptance criteria:

- Verification record captures tester, reviewer, testing performed, updated date, and verified date where applicable.
- MVP can default tester/reviewer to local profile values but must allow edit if no identity system exists.

## 3.4 Pass verification

Acceptance criteria:

- Reviewer can mark Pass only when required checks are satisfied.
- Version status becomes Verified.
- Verified timestamp and reviewer are recorded.
- Version becomes immutable.

## 3.5 Fail or amend review

Acceptance criteria:

- Reviewer can fail verification with reason.
- Reviewer can request amendment with reason.
- Failed/amended version is not active.
- Amendment creates/reopens draft path without mutating verified evidence.

# 4. Required verification evidence

Minimum evidence:

- Workflow version ID.
- Verification execution ID or documented reason if manual review only.
- Runtime parameter values used.
- Input dataset versions/fingerprints.
- Output dataset references.
- Tester.
- Reviewer.
- Decision: Pass, Fail, Amend.
- Decision notes.
- Timestamp.

# 5. Data model touchpoints

- `VerificationRecord`
- `VerificationDecision`
- `ExecutionRecord`
- `WorkflowVersion`
- `ReviewerNote`
- `EvidencePackage`

# 6. Tests

Minimum tests:

- Draft can submit for review only when valid.
- Sample run links to verification record.
- Pass requires reviewer and evidence.
- Pass changes version to Verified.
- Verified version becomes immutable.
- Fail records reason and does not verify.
- Amend creates/reopens draft without changing verified records.
