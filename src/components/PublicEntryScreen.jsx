import { useState } from 'react';
import AuthScreen from './AuthScreen.jsx';
import PublicApplicationForm from './PublicApplicationForm.jsx';

/** What renders before anyone is logged in — the ordinary login screen by default, or the public
    admissions form when "Apply for admission" is clicked. No URL routing exists anywhere in this
    app (App.jsx's Gate() just switches components on auth state), so this is a second, purely
    local toggle rather than a real route — matching that existing architecture instead of adding
    a router dependency just for one public page. */
export default function PublicEntryScreen() {
  const [showApply, setShowApply] = useState(false);

  if (showApply) return <PublicApplicationForm onBackToLogin={() => setShowApply(false)} />;
  return <AuthScreen onApply={() => setShowApply(true)} />;
}
