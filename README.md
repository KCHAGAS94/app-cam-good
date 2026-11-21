# CamGood

Sistema para as câmeras lâmpada Altomex AL-D890 (app do fabricante: PIX-LINK CAM).

```
app-cam-good/
├── app/      Aplicativo Android (React Native) — vídeo ao vivo, controles, gravações do cartão
├── server/   API central (Node + Express + PostgreSQL) — roda no PC, guarda fotos/vídeos
└── web/      Painel web (React + Vite + TypeScript) — compilado para server/public
```

## app — aplicativo

```powershell
cd app
npx tsc --noEmit            # checagem de tipos
npx jest                    # testes
cd android
.\gradlew.bat assembleRelease   # gera app\android\app\build\outputs\apk\release\app-release.apk
```

A conexão com a câmera usa a biblioteca do fabricante, por isso o app é só Android.

**Bibliotecas da câmera (não estão no repositório):** são arquivos do fabricante e não são
distribuídos aqui. Para compilar, extraia do app oficial PIX-LINK CAM (pacote
`shix.pixlink.camera`, split `arm64_v8a`) os arquivos abaixo e coloque em
`app/android/app/src/main/jniLibs/arm64-v8a/`:

```
libc++_shared.so  libavcodec.so  libavfilter.so  libavformat.so
libavutil.so      libpostproc.so libswresample.so libswscale.so  libobject_jni.so
```

## server — API central

```powershell
cd web
npm install
npm run build    # gera o painel em server/public (necessário antes do primeiro start)
cd ..\server
npm install
npm start        # http://localhost:8080 (API + painel)
npm test         # teste completo no banco camgood_test
```

Configuração em `server/.env` (não vai para o git). Exemplo:

```
PORT=8080
DATABASE_URL=postgres://camgood:SENHA@localhost:5432/camgood
JWT_SECRET=<texto aleatório longo>
CAMERA_SECRET=<outro texto aleatório longo>
MEDIA_DIR=D:\CamGood\midia
```

## web — painel

```powershell
cd web
npm run dev      # desenvolvimento em http://localhost:5173 (repassa /api para o servidor)
npm run build    # gera os arquivos em server/public
```
