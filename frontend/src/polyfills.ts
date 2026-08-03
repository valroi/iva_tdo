// Полифилы для чуть устаревших браузеров (корпоративные машины, где нельзя
// обновить Chrome/Edge). Импортируется ПЕРВЫМ в main.tsx — до react-pdf/pdf.js.
//
// Promise.withResolvers — API из конца 2023 (Chrome/Edge 119+, Safari 17.4+,
// Firefox 121+). pdf.js 5 его использует; на старом браузере рендер PDF падал
// с «Promise.withResolvers is not a function» → экран «Ошибка интерфейса».
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== "function") {
  (Promise as unknown as { withResolvers: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } }).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
