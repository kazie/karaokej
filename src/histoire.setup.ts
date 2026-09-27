// Histoire runs this file in its own UI and in each story preview. Only the
// previews get the app's dark page styles; the UI just needs the tokens.
import './tokens.css'

if (location.pathname.includes('__sandbox')) {
  void import('./style.css')
}
