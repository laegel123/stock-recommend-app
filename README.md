# stock-recommend-app

거대 투자자(워런 버핏/버크셔, 국민연금 등)가 **어디에 투자하는지** 공개 규제 공시로 추적해,
그들이 분기마다 무엇을 새로 사고/늘리고/팔았는지 피드로 보여주고, 여러 거물이 공통으로 담는 종목을
**합의 랭킹**으로 추천하는 앱. 투자자별 과거 성공률·성과와 시각화도 제공한다.

> Track where large investors (Warren Buffett/Berkshire, Korea's NPS, famous funds) put their money via
> public regulatory filings (SEC EDGAR 13F, DART), surface their quarterly buys/sells, rank consensus picks,
> and show each investor's historical performance with visualizations.

## 데이터 출처
- **미국**: SEC EDGAR 13F 공시 (무료, 분기·45일 지연, 롱·미국상장 종목만)
- **한국**: 금융감독원 DART OpenAPI (fast-follow)

## 상태
초기 기획 단계. 구현 계획은 [`docs/PLAN.md`](docs/PLAN.md) 참고.

## ⚠️ 면책 (Disclaimer)
본 앱은 공개 규제 공시를 **정보 목적**으로 집계할 뿐입니다. **투자 자문이나 매매 권유가 아니며**,
면허를 가진 금융 자문사가 제공하는 것이 아닙니다. 공시는 지연·불완전할 수 있으니, 직접 조사하거나
전문가와 상담하시기 바랍니다.

This app aggregates publicly disclosed regulatory filings for informational purposes only. It is NOT
investment advice and NOT a recommendation to buy or sell any security.
