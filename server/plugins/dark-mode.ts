/**
 * Nitro plugin: injects a synchronous blocking script into <head> to apply
 * the .dark class before first paint, preventing flash of light theme (FOUC).
 *
 * This is the same technique used by @nuxtjs/color-mode. The script reads
 * the theme-mode cookie and resolves "system" via matchMedia client-side.
 */
const SCRIPT = `(function(){try{var m=document.cookie.match(/theme-mode=([^;]+)/);var v=m?m[1]:"system";var d=v==="dark"||(v==="system"&&window.matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`.trim()

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("render:html", (html) => {
    html.head.unshift(`<script>${SCRIPT}</script>`)
  })
})
