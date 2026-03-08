// This script will be injected into YouTube video pages.
// It will add a "Copy Transcript" button and fetch transcripts via YouTube's innertube API.

function createCopyButton() {
  const button = document.createElement("button");
  button.className = "yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading";
  button.style.marginLeft = '8px';
  button.addEventListener('click', onCopyTranscriptClick);

  const iconDiv = document.createElement('div');
  iconDiv.className = 'yt-spec-button-shape-next__icon';
  iconDiv.setAttribute('aria-hidden', 'true');
  const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgIcon.setAttribute('height', '24px');
  svgIcon.setAttribute('viewBox', '0 0 24 24');
  svgIcon.setAttribute('width', '24px');
  svgIcon.setAttribute('focusable', 'false');
  svgIcon.setAttribute('fill', 'none');

  svgIcon.innerHTML = `<path d="M16.5 3H5V17M8 6V21H20V6H8Z" stroke="currentColor" stroke-width="1"/>`;
  iconDiv.appendChild(svgIcon);

  const textDiv = document.createElement('div');
  textDiv.className = 'yt-spec-button-shape-next__button-text-content';
  const textSpan = document.createElement('span');
  textSpan.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
  textSpan.textContent = "Copy";
  textDiv.appendChild(textSpan);

  button.appendChild(iconDiv);
  button.appendChild(textDiv);

  return button;
}

function addCopyButton() {
  const shareButton = document.querySelector('ytd-menu-renderer button[aria-label="Share"]');
  const existingCopyButton = document.querySelector("#copy-transcript-button");

  if (shareButton && !existingCopyButton) {
    const buttonWrapper = shareButton.closest('yt-button-view-model');
    if (buttonWrapper) {
      const copyButton = createCopyButton();
      copyButton.id = "copy-transcript-button";
      buttonWrapper.parentNode.insertBefore(copyButton, buttonWrapper.nextSibling);
      return true;
    }
  }
  return false;
}

async function onCopyTranscriptClick() {
  const copyButton = document.querySelector("#copy-transcript-button");
  const textSpan = copyButton.querySelector('.yt-core-attributed-string');

  if (!textSpan) return;

  const originalText = textSpan.textContent;
  textSpan.textContent = "Copying...";

  try {
    const transcriptText = await fetchTranscript();
    await navigator.clipboard.writeText(transcriptText);

    textSpan.textContent = "Copied!";
    setTimeout(() => {
      textSpan.textContent = originalText;
    }, 2000);

  } catch (error) {
    console.error("[Transcript Copier] Error:", error);
    alert("Failed to copy transcript: " + error.message);
    textSpan.textContent = originalText;
  }
}

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

// Build protobuf params for get_transcript API
function buildTranscriptParams(videoId) {
  const encoder = new TextEncoder();
  const videoIdBytes = encoder.encode(videoId);

  // Protobuf: outer field 1 (message) containing inner field 1 (string) = videoId
  // Inner: 0x0A <videoId.length> <videoId bytes>
  // Outer: 0x0A <inner.length> <inner bytes>
  const innerLen = 1 + 1 + videoIdBytes.length;
  const bytes = new Uint8Array([
    0x0A, innerLen,
    0x0A, videoIdBytes.length,
    ...videoIdBytes
  ]);

  return btoa(String.fromCharCode(...bytes));
}

// Fetch transcript using YouTube's get_transcript innertube API
async function fetchTranscript() {
  const videoId = getVideoId();
  if (!videoId) throw new Error("Could not determine video ID.");

  console.log("[Transcript Copier] Fetching transcript for video:", videoId);

  const params = buildTranscriptParams(videoId);
  console.log("[Transcript Copier] Params:", params);

  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260306.01.00',
        }
      },
      params: params,
    }),
  });

  console.log("[Transcript Copier] Response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Transcript Copier] Error response:", errorText.substring(0, 500));
    throw new Error(`Transcript API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log("[Transcript Copier] Response keys:", Object.keys(data));

  // Extract transcript segments from the response
  const actions = data.actions;
  if (!actions || actions.length === 0) {
    throw new Error("No transcript data in response.");
  }

  // Navigate the response structure to find cue groups
  let cueGroups = null;
  for (const action of actions) {
    const panel = action.updateEngagementPanelAction?.content?.transcriptRenderer;
    if (panel) {
      cueGroups = panel.body?.transcriptBodyRenderer?.cueGroups;
      break;
    }
  }

  if (!cueGroups || cueGroups.length === 0) {
    // Try alternative response structure
    for (const action of actions) {
      const searchPanel = action.updateEngagementPanelAction?.content?.transcriptSearchPanelRenderer;
      if (searchPanel) {
        cueGroups = searchPanel.body?.transcriptSegmentListRenderer?.initialSegments;
        break;
      }
    }
  }

  if (!cueGroups || cueGroups.length === 0) {
    console.log("[Transcript Copier] Full response:", JSON.stringify(data).substring(0, 2000));
    throw new Error("Could not find transcript segments in response.");
  }

  // Extract text from cue groups
  let transcript = '';
  for (const group of cueGroups) {
    const cues = group.transcriptCueGroupRenderer?.cues;
    if (cues) {
      for (const cue of cues) {
        const text = cue.transcriptCueRenderer?.cue?.simpleText;
        if (text && text.trim()) {
          transcript += text.replace(/\n/g, ' ').trim() + ' ';
        }
      }
    } else {
      // Alternative: transcriptSegmentRenderer
      const segText = group.transcriptSegmentRenderer?.snippet?.runs;
      if (segText) {
        const text = segText.map(r => r.text || '').join('');
        if (text.trim()) {
          transcript += text.replace(/\n/g, ' ').trim() + ' ';
        }
      }
    }
  }

  if (!transcript.trim()) {
    throw new Error("Transcript was empty.");
  }

  console.log("[Transcript Copier] Got transcript, length:", transcript.length);
  return transcript.trim();
}

const buttonObserver = new MutationObserver(() => {
  addCopyButton();
});

buttonObserver.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && !event.metaKey && event.key === 'c') {
    event.preventDefault();
    onCopyTranscriptClick();
  }
});
