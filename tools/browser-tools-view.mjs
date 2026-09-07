// These regression scenarios exercise controls in the expanded console.
// The immersive default and its discovery paths have their own browser suite.
const configured = new WeakSet();
export async function useExpandedTools(page) {
  if (configured.has(page)) return;
  configured.add(page);
  await page.evaluateOnNewDocument(() => {
    const key = 'abyssal:expedition-settings';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ immersive: false }));
  });
}
