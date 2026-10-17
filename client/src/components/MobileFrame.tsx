import type { ReactNode } from 'react';

// 화면 크기
const FRAME_WIDTH = 390;
const FRAME_HEIGHT = 780;

export default function MobileFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#525659',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: `${FRAME_WIDTH}px`,
          height: `${FRAME_HEIGHT}px`,
          maxWidth: '100vw',
          maxHeight: '100dvh',
          background: '#fff',
          overflow: 'hidden',
          boxShadow: '0 0 24px rgba(0,0,0,0.4)',
          borderRadius: '0px',
        }}
      >
        {children}
      </div>
    </div>
  );
}