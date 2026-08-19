async function pollDeployment() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch("https://munchieskk.vercel.app/?t=" + Date.now(), { cache: "no-store" });
      const html = await res.text();
      const jsMatch = html.match(/assets\/index-([^.]+)\.js/);
      const jsHash = jsMatch ? jsMatch[1] : "unknown";
      console.log(`[Attempt ${i + 1}] Current Live JS Bundle: index-${jsHash}.js`);
    } catch (e) {
      console.log("Polling error:", e.message);
    }
    await new Promise(r => setTimeout(r, 4000));
  }
}
pollDeployment();
