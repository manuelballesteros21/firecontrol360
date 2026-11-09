import type { Metadata } from 'next';
import './styles.css';
export const metadata: Metadata = { title: 'FireControl 360', description: 'Inventario y control de equipos contra incendios' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-MX"><body>{children}</body></html>;
}
