# WiseDemo V2 audit and architecture

## Audit findings

The pre-V2 pipeline correctly creates an immutable Steel source recording, validates/remuxes HLS media, and stores a server-proxied MP4. Its creative failure is upstream of media finalization: reconnaissance persists a markdown outline of selectors, feature choice follows a prompt rather than evidence-backed workflow scoring, and the planner emits one linear action list. The composition system then applies generic captions and guessed zoom positions to the entire raw timeline.

## V2 lifecycle

`Product intelligence -> workflow recommendations -> selected storyboard -> verified scene capture metadata -> editorial composition -> structured quality review` runs alongside, not instead of, the raw recording lifecycle. Product intelligence, storyboards, scene captures, and quality reviews are versioned Appwrite rows. Recon screenshots are private Appwrite evidence assets. The source Steel MP4 remains immutable.

## WiseResume vertical

The generic recon engine probes only safe, meaningful state changes. The WiseResume adapter may enrich language handling or workflow semantics but never owns selectors in the generic engine. A successful resume-tailoring recommendation becomes a launch story with a hook, visible action, transformation, proof, and CTA. The system composes only verified source intervals and surfaces any missing capture or quality issue instead of claiming success.

## Current limits

The initial quality reviewer is evidence- and metadata-based. It explicitly reports that limitation; a future configured vision provider can add key-frame understanding. Voiceover is provider-independent and disabled by default, so launch videos still render with timed benefit captions when no voice provider is configured.
