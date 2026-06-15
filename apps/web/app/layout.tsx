import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DISCLAIMER } from '@app/shared';
import './globals.css';

export const metadata: Metadata = {
  title: 'stock-recommend-app',
  description: '거대 투자자의 공개 규제 공시를 정보 목적으로 집계하는 피드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        {/* ADR-0013: 모든 화면에 면책 문구 상시 노출 */}
        <footer className="mx-auto max-w-3xl border-t border-gray-200 px-4 py-6 text-xs text-gray-500">
          {DISCLAIMER}
        </footer>
      </body>
    </html>
  );
}
