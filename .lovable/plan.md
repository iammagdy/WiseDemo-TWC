## الخطة

هحوّل الـ MVP من مجرد لقطة/زر تحميل إلى flow واضح يشتغل حتى لو الموقع محتاج login أو screenshot service رجّعت صفحة فاضية.

### 1. إصلاح تحليل الرابط والـ Site Map
- عند إنشاء project أو الضغط على “Scan real site”، التطبيق سيحلّل الرابط الأساسي فعليًا ويطلع:
  - عنوان ووصف المنتج.
  - أهم الروابط الداخلية.
  - CTAs/headings.
  - صفحات auth المحتملة مثل `/auth`, `/login`, `/signin`, `/sign-in` حسب الروابط الموجودة في الموقع.
- لو الموقع ما رجّعش روابط كفاية، سنعمل probing آمن لمسارات auth الشائعة ونختار الموجود بدل الافتراض الحالي `/login`.

### 2. إصلاح حقل الـ Authentication
- إزالة الافتراض الثابت الحالي الذي يضع `${baseUrl}/login`.
- تعبئة Login URL تلقائيًا من نتيجة التحليل:
  - يفضّل route مكتشف من الموقع مثل `/auth`.
  - لو لم يتم اكتشاف auth، يترك الحقل فارغًا أو يقترح “not needed”.
- لو المستخدم لم يضع credentials، سيتم اعتبار demo public landing-page recording وليس login recording.

### 3. إصلاح إنتاج الفيديو الفعلي
- بدل الاعتماد فقط على صورة خارجية قد تظهر بيضاء، سنبني renderer داخلي أقوى:
  - يحاول تحميل capture حقيقي للصفحة.
  - إن فشل أو كانت الصورة بيضاء/فارغة، يستخدم HTML/text/links المستخرجة من scan لرسم demo landing-page احترافي على canvas بدل blank white.
  - يضيف حركة scroll down/up، cursor movement، callout overlays، ولقطات section-by-section من الـ sitemap.
- الفيديو سيكون downloadable blob حقيقي، والزر لن يظهر إلا بعد التأكد أن الملف اتولد بحجم صالح.

### 4. تجربة المستخدم أثناء التشغيل
- إضافة حالات واضحة داخل Demo Queue:
  - Scanning site
  - Preparing scenes
  - Rendering video
  - Ready to download
  - Failed with retry
- لو render فشل، يظهر سبب مفهوم وزر retry بدل شاشة بيضاء أو زر download لا يعمل.

### 5. حفظ نتيجة الفيديو في نفس الجلسة وتحسين التحميل
- بعد render، يتم إنشاء رابط تحميل صالح للمتصفح الحالي.
- سنمنع إنشاء “Download video” لو لم يتم تسجيل chunks فعلية من MediaRecorder.
- إن كان المتصفح لا يدعم MediaRecorder، يظهر fallback واضح بدل silent failure.

### 6. التحقق النهائي
- سأختبر flow كامل:
  1. إنشاء project من URL.
  2. التأكد أن scan يملأ map وauth route الصحيح إن وجد.
  3. إنشاء demo بدون credentials والتأكد أنه يعمل كـ landing-page scroll video.
  4. التأكد أن الفيديو ليس blank وأن زر Download يعمل.

## التفاصيل التقنية المؤكدة من الكود الحالي
- الـ UI حاليًا يضع Login URL افتراضيًا كـ `${baseUrl}/login`، وهذا سبب ظهور `/login` بدل `/auth`.
- الـ renderer الحالي يعتمد على `/api/public/screenshot?...` ثم يرسم الصورة على canvas؛ لو الصورة الخارجية رجعت بيضاء فالنتيجة تطلع فيديو أبيض.
- إنشاء demo حاليًا يرجع status `ready` وthumbnail فقط، لكن لا يوجد validation كافي أن الفيديو المسجل يحتوي frames حقيقية قبل إظهار download.

بعد موافقتك هطبق الخطة مباشرة.