import { useNavigation } from '../context/NavigationContext.jsx';

/** Port of the `.section` / `.section.active` class-toggling in showSection() — every page stays
    mounted at all times (matching the original always-in-DOM sections) so per-page state (search
    box text, filters, tab selection) survives navigating away and back. */
export default function Section({ name, children }) {
  const { activeSection } = useNavigation();
  return <div className={'section' + (activeSection === name ? ' active' : '')}>{children}</div>;
}
