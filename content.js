// This script will be injected into YouTube video pages.
// It will add a "Copy Transcript" button and handle the copy logic. 

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
  
  // Use the new, thinner, stroked path for the icon
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

  if (!textSpan) return; // Safety check

  const originalText = textSpan.textContent;
  textSpan.textContent = "Copying...";

  try {
    await openTranscript();
    const transcriptText = await getTranscriptText();
    await navigator.clipboard.writeText(transcriptText);

    textSpan.textContent = "Copied!";
    setTimeout(() => {
      textSpan.textContent = originalText;
    }, 2000);

  } catch (error) {
    console.error("Could not copy transcript:", error);
    alert("Failed to copy transcript: " + error.message);
    textSpan.textContent = originalText;
  }
}

function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            return resolve(element);
        }

        const observer = new MutationObserver(mutations => {
            const el = document.querySelector(selector);
            if (el) {
                clearTimeout(timeoutId);
                observer.disconnect();
                resolve(el);
            }
        });

        const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timed out waiting for selector: ${selector}`));
        }, timeout);

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

const EXCLUDED_TRANSCRIPT_TEXTS = [
    'sync to video time',
    'follow along',
    'search in video',
    'search transcript',
];

async function getTranscriptText() {
    const segments = findTranscriptSegments();

    if (!segments || segments.length === 0) {
        throw new Error("Transcript panel opened, but no text segments were found.");
    }

    let transcript = '';
    segments.forEach(segment => {
        const text = segment.textContent.trim();
        if (text && !EXCLUDED_TRANSCRIPT_TEXTS.includes(text.toLowerCase())) {
            transcript += text + ' ';
        }
    });
    return transcript.trim();
}

// All known transcript segment selectors across YouTube versions
const TRANSCRIPT_SELECTORS = [
    // Specific panels
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] .segment-text',
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"] span.yt-core-attributed-string',
    // Generic segment selectors
    '#segments-container .segment-text',
    '#segments-container yt-formatted-string',
    'ytd-transcript-segment-renderer .segment-text',
    'ytd-transcript-segment-renderer',
    // Broad: any engagement panel
    'ytd-engagement-panel-section-list-renderer .segment-text',
    'ytd-transcript-renderer .segment-text',
];

// Find transcript text from the currently expanded engagement panel
function findTranscriptFromExpandedPanel() {
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
    for (const panel of panels) {
        // Check if this panel looks like a transcript (has a "Transcript" title)
        const titleEl = panel.querySelector('#title-text');
        if (titleEl && titleEl.textContent.trim().toLowerCase() === 'transcript') {
            // This is the transcript panel - grab all text content from segments
            // Try various known selectors within this panel
            const selectors = [
                '.segment-text',
                'yt-formatted-string.segment-text',
                'ytd-transcript-segment-renderer .segment-text',
                'ytd-transcript-segment-renderer',
                '#segments-container .segment-text',
                '#segments-container yt-formatted-string',
                'span.yt-core-attributed-string',
            ];
            for (const sel of selectors) {
                const segments = panel.querySelectorAll(sel);
                if (segments.length > 3) {
                    console.log('[Transcript Copier] Found segments in expanded panel with selector:', sel, 'count:', segments.length);
                    return segments;
                }
            }
            // Last resort: look for all yt-formatted-string elements in the panel body
            const content = panel.querySelector('#content');
            if (content) {
                const allFormatted = content.querySelectorAll('yt-formatted-string');
                if (allFormatted.length > 3) {
                    console.log('[Transcript Copier] Found segments via yt-formatted-string in expanded panel, count:', allFormatted.length);
                    return allFormatted;
                }
                // Ultra broad: any element that looks like transcript text
                const allSpans = content.querySelectorAll('span');
                const textSpans = Array.from(allSpans).filter(s => {
                    const text = s.textContent.trim();
                    return text.length > 0 && text.length < 500 && !s.querySelector('*:not(br)');
                });
                if (textSpans.length > 3) {
                    console.log('[Transcript Copier] Found segments via leaf spans in expanded panel, count:', textSpans.length);
                    return textSpans;
                }
            }
            console.log('[Transcript Copier] Transcript panel found but no segments. innerHTML (2000 chars):', panel.innerHTML.substring(0, 2000));
            return null;
        }
    }
    return null;
}

function findTranscriptSegments() {
    // First try specific selectors
    for (const selector of TRANSCRIPT_SELECTORS) {
        const segments = document.querySelectorAll(selector);
        if (segments.length > 0) {
            console.log('[Transcript Copier] Found segments with selector:', selector, 'count:', segments.length);
            return segments;
        }
    }
    // Then try finding from expanded panel
    return findTranscriptFromExpandedPanel();
}

function isTranscriptLoaded() {
    return findTranscriptSegments() !== null;
}

function waitForTranscript(timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (isTranscriptLoaded()) return resolve();

        const observer = new MutationObserver(() => {
            if (isTranscriptLoaded()) {
                clearTimeout(timeoutId);
                observer.disconnect();
                resolve();
            }
        });

        const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Transcript content did not load."));
        }, timeout);

        observer.observe(document.body, { childList: true, subtree: true });
    });
}

function openTranscript() {
    return new Promise(async (resolve, reject) => {
        // If transcript content is already rendered, we're good.
        if (isTranscriptLoaded()) {
            return resolve();
        }

        // First, click "...more" to expand the description box if it's not already.
        const expanderButton = document.querySelector('tp-yt-paper-button#expand.ytd-text-inline-expander');
        if (expanderButton) {
            expanderButton.click();
            await new Promise(r => setTimeout(r, 250));
        }

        // CASE 1: The "Show transcript" button is under the description.
        const directTranscriptButton = document.querySelector('ytd-video-description-transcript-section-renderer button');
        if (directTranscriptButton) {
            directTranscriptButton.click();
            try {
                await waitForTranscript(10000);
                return resolve();
            } catch (error) {
                return reject(new Error("Clicked 'Show transcript', but content did not load. Check console for debug info."));
            }
        }

        // CASE 2: The "Show transcript" button is in the "..." menu.
        const menuButton = document.querySelector('ytd-menu-renderer #button-shape > button[aria-label="More actions"]');
        if (menuButton) {
            menuButton.click();
            try {
                const popup = await waitForElement("ytd-popup-container", 2000);
                const transcriptMenuItem = Array.from(popup.querySelectorAll('ytd-menu-service-item-renderer yt-formatted-string'))
                                                  .find(el => el.textContent.trim() === 'Show transcript');
                if (transcriptMenuItem) {
                    transcriptMenuItem.click();
                    await waitForTranscript(5000);
                    return resolve();
                }
            } catch (error) {
                 return reject(new Error("Could not load transcript from the 'More actions' menu."));
            }
        }

        reject(new Error("Could not find a 'Show transcript' button on the page."));
    });
}

const observer = new MutationObserver(() => {
    addCopyButton();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Listen for keyboard shortcuts directly in the content script
document.addEventListener('keydown', (event) => {
    // Check for Ctrl+C on Mac (event.metaKey is for Command key)
    if (event.ctrlKey && !event.metaKey && event.key === 'c') {
        event.preventDefault(); // Prevent the default copy action
        onCopyTranscriptClick();
    }
}); 