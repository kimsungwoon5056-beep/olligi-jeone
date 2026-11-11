# 함께 쓴 라이브러리와 모델 (Third-party notices)

"올리기 전에"는 아래 오픈소스 라이브러리와 공개 모델을 고치지 않고 그대로 이 폴더에 넣어 씁니다.
모든 처리는 사용자의 브라우저 안에서 이뤄지고, 사진은 어디로도 보내지 않습니다.

| 폴더 | 이름 · 버전 | 하는 일 | 라이선스 | 출처 |
|---|---|---|---|---|
| `tesseract/` | Tesseract.js 5.1.1 | 글자 읽기(OCR) | Apache-2.0 (`tesseract/LICENSE.txt`) | https://github.com/naptha/tesseract.js |
| `tesseract-core/` | tesseract.js-core 5.1.1 | OCR 엔진(WebAssembly) | Apache-2.0 (`tesseract-core/LICENSE.txt`) | https://github.com/naptha/tesseract.js-core |
| `lang/` | tessdata_best (int) 한국어·영어, @tesseract.js-data 1.0.0 | OCR 언어 모델 | Apache-2.0 | https://github.com/tesseract-ocr/tessdata_best |
| `mediapipe/` | MediaPipe Tasks Vision 0.10.14, BlazeFace short range | 얼굴 찾기 | Apache-2.0 (`mediapipe/LICENSE.txt`) | https://github.com/google-ai-edge/mediapipe |
| `misc/jsQR.min.js` | jsQR 1.4.0 | QR 읽기 | Apache-2.0 (`misc/jsQR-LICENSE.txt`) | https://github.com/cozmo/jsQR |
| `misc/exifr-lite.umd.js` | exifr 7.1.3 | 사진 속 숨은 정보 읽기 | MIT (`misc/exifr-LICENSE.txt`) | https://github.com/MikeKovarik/exifr |
| `ort/` | ONNX Runtime Web 1.20.1 | 장면 판단 AI 실행 | MIT (`ort/LICENSE.txt`) | https://github.com/microsoft/onnxruntime |
| `ort16/` | ONNX Runtime Web 1.16.3 (한 일꾼용 wasm-core) | 1.20이 안 되는 기기에서 쓰는 예비 실행 엔진 | MIT (`ort16/LICENSE.txt`) | https://github.com/microsoft/onnxruntime |
| `clip/mobileclip_s0_vision_fp16.onnx` | MobileCLIP S0 이미지 모델 (Xenova의 ONNX·16비트 변환본) | 장면 판단 AI | **Apple ML Research Model License** (`clip/LICENSE_MODELS.txt`) | https://github.com/apple/ml-mobileclip · https://huggingface.co/Xenova/mobileclip_s0 |
| `clip/scene_labels.json` | 위 모델의 문장 모델로 미리 계산한 장면 설명 임베딩 (직접 만듦) | 장면 판단 AI | 위와 같음 | `tools/make_scene_labels.py` |

## MobileCLIP 고지

Apple Machine Learning Research Model is licensed under the Apple Machine Learning Research Model License Agreement.

- 이 모델은 **연구·비상업 목적**으로만 쓸 수 있습니다. 이 저장소는 공모전용 비상업 시연(PoC)입니다.
- 변경 사항: Apple이 공개한 MobileCLIP S0를 Xenova가 ONNX로 바꾼 16비트 이미지 모델을 그대로 씁니다. 모델 자체는 고치지 않았습니다.
  장면 설명 문장의 임베딩은 같은 모델의 문장 부분(16비트 ONNX)으로 미리 계산해 `scene_labels.json`에 저장했습니다.
- 서비스로 상용화할 때는 상업적 이용이 가능한 모델(예: MIT 라이선스의 TinyCLIP)로 바꿀 계획입니다.
- Apple의 이름과 상표는 이 서비스를 홍보하거나 Apple과의 관계를 나타내는 데 쓰지 않습니다.
