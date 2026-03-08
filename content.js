// YouTube Transcript Copier - DOM-based approach
// Clicks "Show transcript" button and scrapes text from the transcript panel.

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

// Find the transcript panel (opened or hidden)
function findTranscriptPanel() {
  const allPanels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  for (const p of allPanels) {
    const tid = p.getAttribute('target-id') || '';
    if (tid.includes('transcript')) {
      return p;
    }
  }
  return null;
}

// Open the transcript panel by clicking "Show transcript"
async function openTranscriptPanel() {
  // Check if transcript panel is already expanded
  const existingPanel = findTranscriptPanel();
  if (existingPanel && existingPanel.getAttribute('visibility')?.includes('EXPANDED')) {
    return existingPanel;
  }

  // Find "Show transcript" button
  let transcriptButton = document.querySelector('button[aria-label="Show transcript"]');

  // If not found, expand description first
  if (!transcriptButton) {
    const moreButton = document.querySelector('tp-yt-paper-button#expand')
      || document.querySelector('#expand')
      || document.querySelector('ytd-text-inline-expander #expand');
    if (moreButton) {
      moreButton.click();
      await new Promise(r => setTimeout(r, 800));
    }
    transcriptButton = document.querySelector('button[aria-label="Show transcript"]');
  }

  // Fallback: search by text content
  if (!transcriptButton) {
    const allButtons = document.querySelectorAll('button, ytd-button-renderer button');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (text && (text.includes('show transcript') || text === 'transcript')) {
        transcriptButton = btn;
        break;
      }
    }
  }

  if (!transcriptButton) {
    throw new Error("Could not find 'Show transcript' button. This video may not have a transcript.");
  }

  transcriptButton.click();
  await new Promise(r => setTimeout(r, 1500));

  // Find the expanded transcript panel
  const panel = findTranscriptPanel();
  if (!panel) {
    throw new Error("Transcript panel did not open after clicking button.");
  }

  return panel;
}

// Wait for transcript-segment-view-model elements to appear
function waitForSegments(panel, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      // New YouTube uses transcript-segment-view-model
      let segments = panel.querySelectorAll('transcript-segment-view-model');
      if (segments.length > 0) return segments;
      // Fallback: old selector
      segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
      if (segments.length > 0) return segments;
      return null;
    };

    const existing = check();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const found = check();
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(panel, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error("Timed out waiting for transcript segments to load."));
    }, timeout);
  });
}

async function fetchTranscript() {
  const panel = await openTranscriptPanel();

  // Wait for segments to render
  await new Promise(r => setTimeout(r, 1000));
  const segments = await waitForSegments(panel, 8000);

  console.log("[Transcript Copier] v4 - Found", segments.length, "segments");

  // Debug: log raw text of first 3 segments with char codes
  for (let i = 0; i < Math.min(3, segments.length); i++) {
    const raw = segments[i].textContent;
    console.log("[Transcript Copier] Segment", i, "raw:", JSON.stringify(raw));
  }

  // Extract text from each segment
  let transcript = '';
  for (const segment of segments) {
    const raw = segment.textContent?.trim();
    if (!raw) continue;
    transcript += raw + '\n';
  }

  // Post-process: strip timestamp patterns from the full transcript
  // Patterns: "37 seconds", "1 minute, 16 seconds", "2 minutes, 1 second"
  transcript = transcript.replace(/\d+\s+minutes?,\s*\d+\s+seconds?\s*\n/gi, '\n');
  transcript = transcript.replace(/\d+\s+seconds?\s*\n/gi, '\n');
  transcript = transcript.replace(/\d+\s+minutes?\s*\n/gi, '\n');
  // Also handle if timestamps are at the end of a line without newline
  transcript = transcript.replace(/\d+\s+minutes?,\s*\d+\s+seconds?\s*$/gim, '');
  transcript = transcript.replace(/\d+\s+seconds?\s*$/gim, '');
  transcript = transcript.replace(/\d+\s+minutes?\s*$/gim, '');
  // Clean up: join lines into single text
  transcript = transcript.split('\n').map(l => l.trim()).filter(l => l).join(' ');

  if (!transcript.trim()) {
    throw new Error("Transcript was empty after scraping segments.");
  }

  console.log("[Transcript Copier] Got transcript, length:", transcript.length);

  // Close the transcript panel
  const closeButton = panel.querySelector('#visibility-button button')
    || panel.querySelector('button[aria-label="Close transcript"]');
  if (closeButton) {
    closeButton.click();
  }

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
