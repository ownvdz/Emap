import type { ReactNode } from 'react';

const FRAME_WIDTH = 390; // iPhone 기준 너비
const FRAME_HEIGHT = 844; // iPhone 기준 높이

export default function MobileFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#525659', // 프레임 바깥 배경 (데스크톱에서 보일 때)
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