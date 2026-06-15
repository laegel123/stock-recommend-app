/**
 * ADR-0013: 모든 화면·API 응답에 상시 노출되는 투자 자문 면책 문구(단일 진실원).
 * 중립 표현만 사용한다("사세요" 등 매매 권유 금지).
 */
export const DISCLAIMER =
  '본 앱은 공개 규제 공시를 정보 목적으로 집계할 뿐이며, 투자 자문이나 매매 권유가 아닙니다. 공시는 지연·불완전할 수 있습니다.';

export type Disclaimer = typeof DISCLAIMER;
