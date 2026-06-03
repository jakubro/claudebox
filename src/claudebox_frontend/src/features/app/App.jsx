/** Root application component — routes between mobile and desktop layouts. */

import useIsMobile from '../../hooks/useIsMobile'
import DesktopLayout from './components/DesktopLayout'
import MobileApp from './components/mobile/MobileApp'

export default function App() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileApp /> : <DesktopLayout />
}
