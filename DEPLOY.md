# 배포 가이드

## 1. GitHub에 올리기

```bash
cd ad-control-center
git init
git add .
git commit -m "feat: 광고관제소 초기 셋업"
git branch -M main
git remote add origin https://github.com/본인이름/ad-control-center.git
git push -u origin main
```

## 2. Railway 배포

### 2-1. Railway 프로젝트 생성
1. https://railway.app 로그인
2. **New Project** 클릭
3. **Deploy from GitHub repo** 선택
4. `ad-control-center` 저장소 선택

### 2-2. PostgreSQL 추가
1. 프로젝트 대시보드에서 **+ New** 클릭
2. **Database** → **PostgreSQL** 선택
3. 자동으로 `DATABASE_URL` 환경변수 연결됨

### 2-3. 환경변수 설정
Railway 프로젝트 → **Variables** 탭에서 아래 추가:

| 변수명 | 값 |
|--------|-----|
| `NODE_ENV` | `production` |
| `ENCRYPTION_KEY` | (아래 명령어로 생성) |
| `CLIENT_URL` | `https://your-app.up.railway.app` |

**ENCRYPTION_KEY 생성 (PowerShell):**
```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
```

### 2-4. 배포 확인
- Railway 대시보드 → **Deployments** 탭에서 로그 확인
- 배포 완료 후 제공되는 URL로 접속
- `https://your-app.up.railway.app/health` → `{"status":"ok"}` 확인

## 3. 채널 API 키 등록
배포된 URL 접속 → 광고계정/연동 메뉴 → 광고주 추가 → 채널 토글 → API 키 입력 → 연동 테스트
