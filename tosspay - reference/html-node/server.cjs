var express = require("express");
var got = require("got");
var { resolve } = require("path");

var app = express();

app.use(express.static(__dirname + "/public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TODO: 개발자센터에 로그인해서 내 결제위젯 연동 키 > 시크릿 키를 입력하세요. 시크릿 키는 외부에 공개되면 안돼요.
// @docs https://docs.tosspayments.com/reference/using-api/api-keys
var secretKey = "test_sk_LlDJaYngro9gNQd5zNyN3ezGdRpX";

app.post("/confirm", function (req, res) {
  var { paymentKey, orderId, amount } = req.body;

  // 토스페이먼츠 API는 시크릿 키를 사용자 ID로 사용하고, 비밀번호는 사용하지 않습니다.
  // 비밀번호가 없다는 것을 알리기 위해 시크릿 키 뒤에 콜론을 추가합니다.
  // @docs https://docs.tosspayments.com/reference/using-api/authorization#%EC%9D%B8%EC%A6%9D
  var encryptedSecretKey = "Basic " + Buffer.from(secretKey + ":").toString("base64");

  // 결제 승인 API를 호출하세요.
  // 결제를 승인하면 결제수단에서 금액이 차감돼요.
  // @docs https://docs.tosspayments.com/guides/v2/payment-widget/integration#3-결제-승인하기
  got
    .post("https://api.tosspayments.com/v1/payments/confirm", {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        orderId: orderId,
        amount: amount,
        paymentKey: paymentKey,
      },
      responseType: "json",
    })
    .then(function (response) {
      // TODO: 결제 완료 비즈니스 로직을 구현하세요.
      console.log(response.body);
      res.status(response.statusCode).json(response.body);
    })
    .catch(function (error) {
      // TODO: 결제 실패 비즈니스 로직을 구현하세요.
      console.log(error.response.body);
      res.status(error.response.statusCode).json(error.response.body);
    });
});

// 3. 빌링키 발급하기 - 카드 자동결제 빌링키 발급 API
// @docs https://docs.tosspayments.com/guides/v2/billing/integration#3-%EB%B9%8C%EB%A7%81%ED%82%A4-%EB%B0%9C%EA%B8%89%ED%95%98%EA%B8%B0
app.post("/billing/issue", function (req, res) {
  var { authKey, customerKey } = req.body;

  var encryptedSecretKey = "Basic " + Buffer.from(secretKey + ":").toString("base64");

  got
    .post("https://api.tosspayments.com/v1/billing/authorizations/" + authKey, {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        customerKey: customerKey,
      },
      responseType: "json",
    })
    .then(function (response) {
      console.log(response.body);
      res.status(response.statusCode).json(response.body);
    })
    .catch(function (error) {
      console.log(error.response.body);
      res.status(error.response.statusCode).json(error.response.body);
    });
});

app.get("/", function (req, res) {
  var path = resolve("./public/checkout.html");
  res.sendFile(path);
});

app.get("/billing", function (req, res) {
  var path = resolve("./public/billing.html");
  res.sendFile(path);
});

app.get("/success", function (req, res) {
  var path = resolve("./public/success.html");
  res.sendFile(path);
});

app.get("/fail", function (req, res) {
  var path = resolve("./public/fail.html");
  res.sendFile(path);
});

app.listen(4242, () => console.log(`http://localhost:${4242} 으로 샘플 앱이 실행되었습니다.`));


