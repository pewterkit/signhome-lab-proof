// "Customer app" fixture for the lab timing (24 Oct 2026). A minimal Firebase web app on a Cloudflare Worker,
// shipped the way many generated apps ship: literal Firebase config with the DEFAULT authDomain and redirect sign-in.
// Served ONLY inside the test's headless browser as https://lab.pewterkit.com (Playwright route; no deploy, no DNS change).
// The lab host is already registered with Google Cloud + Firebase, so fix steps 1-2 are pre-done.
const FB_API_KEY = 'AIzaSyASmWUOeHx61-VYyM3XteLWm164xmlCTco'; // public Firebase web (browser) key of the lab project
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Customer app</title></head><body>
<h1>Customer app</h1><button id="red">Sign in with Google (redirect)</button><pre id="out"></pre>
<script type="module">
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithRedirect,getRedirectResult} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
const firebaseConfig = { apiKey: "${FB_API_KEY}", authDomain: "pewterkit-day0.firebaseapp.com", projectId: "pewterkit-day0" };
const auth=getAuth(initializeApp(firebaseConfig));const prov=new GoogleAuthProvider();prov.setCustomParameters({prompt:'select_account'});
const out=(s)=>document.getElementById('out').textContent+=s+'\\n';
getRedirectResult(auth).catch(e=>out('ERROR '+e.code));
red.onclick=()=>signInWithRedirect(auth,prov).catch(e=>out('ERROR '+(e.code||e.message)));
</script></body></html>`;
export default {
  async fetch(req, env) {
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
