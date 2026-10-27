# Đặc tả nghiệp vụ Inbox Rapiz — tham chiếu Meta Business Suite

**Phiên bản:** 1.0, 27/10/2026 · **Task:** T-095 · **Trạng thái:** đề xuất để chủ sản phẩm duyệt, chưa phải chức năng đã triển khai.

**Người sử dụng tài liệu:** chủ sản phẩm, thiết kế, Claude triển khai, QA. Tài liệu mô tả hành vi người dùng và quy tắc nghiệp vụ; không chỉ định component, database hay API nội bộ.

## 1. Mục tiêu và cách đọc

Xây lại Inbox để nhân viên có thể tìm đúng khách, hiểu lịch sử, trả lời, phân công, theo dõi và cập nhật thông tin khách ngay trong một màn hình. Tham chiếu là màn Meta Business Suite mà chủ sản phẩm mở trong Chrome profile Tùng và hai ảnh cung cấp ngày 27/10/2026.

“Giống Meta” được hiểu là bám bố cục, mật độ thông tin và luồng xử lý của Inbox; giữ thương hiệu Rapiz và mô hình business/shop/bot đã thống nhất. Không thay sidebar chung hoặc các màn khác trong task Inbox. Không sử dụng logo Meta làm thương hiệu Rapiz.

Phạm vi bao quát cả tin nhắn, bình luận, công việc, hồ sơ khách và các lối vào cài đặt/tự động hóa. Có mặt trong danh mục không đồng nghĩa đã có tích hợp vận hành. Mỗi nhóm có mức bằng chứng:

- **QS:** đã quan sát trực tiếp giao diện trên tài khoản tham chiếu. Chỉ xác nhận những trường/nút/nhãn nhìn thấy; không mặc nhiên xác nhận hành vi sau khi lưu.
- **ĐX:** quy tắc đề xuất cho Rapiz để yêu cầu đủ rõ và kiểm thử được; chưa phải quyết định đã được chủ sản phẩm duyệt.
- **ĐK:** chức năng phụ thuộc nền tảng, quyền truy cập hoặc cần khảo sát bổ sung. Không được dựng nút giả rồi xem như đã hoàn thành.
- **GC:** năng lực Rapiz hiện có cần giữ lại; mức hiện thực hiện tại được ghi ở mục 14.

Các yêu cầu dùng ID cố định với namespace INB để chia task và nghiệm thu; đây là ID của đặc tả Inbox, không thay thế feature ID trong PRD toàn repo. Khi tạo task phải giữ ID INB và ánh xạ riêng tới feature ID chung nếu có. Các ví dụ đều giả lập, không dùng nội dung/hồ sơ khách thật.

## 2. Phạm vi, vai trò và đối tượng

**Trong phạm vi:** workspace Inbox, tất cả nhóm chức năng nhìn thấy ở Meta, quy tắc thích nghi với Rapiz, trạng thái, phân quyền, ngoại lệ, nghiệm thu và các phần phải xác minh trước khi triển khai.

**Ranh giới:** màn tạo quảng cáo, quản lý gói, toàn bộ CRM, cấu hình bot và tích hợp nền tảng là các module khác. Inbox được dẫn tới đúng màn có ngữ cảnh; tài liệu này không yêu cầu xây lại các module đó. Gọi điện/video và thanh toán được giữ trong danh mục parity dưới dạng ĐK, không âm thầm loại bỏ và không xem như backend đã hỗ trợ.

| Vai trò nghiệp vụ | Nhu cầu | Quyền mục tiêu — ĐX |
|---|---|---|
| Nhân viên xử lý | Đọc, trả lời, ghi chú, cập nhật thông tin khách được cấp quyền | Chỉ conversation và kênh thuộc phạm vi được cấp; không tự sửa cấu hình toàn business |
| Trưởng nhóm | Phân công, xử lý hàng loạt, kiểm tra tồn đọng | Trong business/shop được quản lý; không truy cập business khác |
| Quản trị business | Quản lý thư viện nhãn, trả lời mẫu, tự động hóa, cài đặt Inbox | Các quyền cấu hình phải được kiểm tra độc lập với quyền trả lời |
| Chủ account | Chuyển business, xem sử dụng gói | Không tự mặc định thành người được giao mọi conversation |
| Bot/automation | Tiếp nhận hoặc trả lời theo cấu hình | Không tương đương một nhân viên; phải tôn trọng tiếp quản của người và giới hạn kênh |

Đây là nhóm quyền nghiệp vụ, không yêu cầu tạo role mới nếu hệ thống hiện có biểu diễn được. Trước khi triển khai phải ánh xạ sang quyền thực tế.

**Từ điển:** business = đơn vị kinh doanh có một loại hình; shop = cửa hàng/đơn vị thuộc business; channel = kết nối cụ thể như một Fanpage/Instagram; provider = Facebook/Instagram/Zalo…; bot = cấu hình trợ lý; conversation = luồng trao đổi trên một channel; customer = hồ sơ CRM liên kết rõ ràng với conversation. Một tên khách giống nhau không chứng minh cùng người.

## 3. Bố cục và giảm thao tác

| ID | Yêu cầu và tiêu chí nghiệm thu |
|---|---|
| INB-UX-01 · QS/ĐX | Desktop có ba vùng: danh sách bên trái, conversation + composer giữa, thông tin khách bên phải. Header kênh nằm trên vùng làm việc. Composer luôn tiếp cận được khi cuộn lịch sử. Cuộn hồ sơ không kéo mất vị trí tin nhắn. |
| INB-UX-02 · ĐX | Giữ sidebar app hiện tại. Không thêm sidebar business/shop mới bên trong Inbox. Thông tin shop/channel đặt gọn ở bộ lọc và header conversation. |
| INB-UX-03 · QS/ĐX | Các thao tác thường dùng đặt trực tiếp: tìm kiếm, chưa đọc, theo dõi/ưu tiên, hoàn tất, phân công, nhãn, ghi chú và trả lời. Mở conversation từ danh sách một lần bấm; hoàn tất một lần bấm; phân công mở menu, chọn người và xác nhận. Không bắt mở CRM để chỉ xem số điện thoại. |
| INB-UX-04 · QS/ĐX | Icon phải có tooltip, tên cho trình đọc màn hình, trạng thái bật/tắt rõ. Không dựa riêng vào màu. Chuỗi dài không làm vỡ bố cục; có cách xem đủ nội dung. |
| INB-UX-05 · ĐX | Có thể thu gọn/mở hồ sơ bên phải để tăng chỗ đọc. Trên màn hẹp hiển thị lần lượt danh sách → conversation → hồ sơ, có quay lại và giữ draft. Không ép ba cột nhỏ trên mobile. Không thay đổi business khi quay lại. |
| INB-UX-06 · GC/ĐX | Giữ điều hướng bàn phím và phím tắt đang có; không kích hoạt khi gõ trong ô nhập. Enter/Shift+Enter phải nhất quán với tùy chọn gửi; Escape đóng menu/editor chưa lưu sau khi cảnh báo nếu có thay đổi. |

Thứ tự vùng phải bám ảnh tham chiếu, không chuyển những tác vụ thường dùng sang các popup trung tâm liên tiếp. Modal vẫn phù hợp cho xác nhận xóa hoặc chỉnh nhiều trường; không áp dụng lại quy tắc account dropdown cho mọi form.

## 4. Ngữ cảnh business, shop, bot và kênh

| ID | Yêu cầu và tiêu chí nghiệm thu |
|---|---|
| INB-CTX-01 · đã thống nhất | Business chọn trên sidebar quyết định toàn bộ danh sách, thống kê đếm, tìm kiếm, customer, thư viện trả lời và quyền trong Inbox. Không có Inbox tổng các business ngầm định. Logo Rapiz vẫn dẫn về thống kê tổng hợp, ngoài phạm vi màn này. |
| INB-CTX-02 · ĐX | Shop là bộ lọc nghiệp vụ; provider/channel/bot là các bộ lọc khác nhau. Chọn shop chỉ hiện các channel và conversation thực sự thuộc shop đó. Không lấy tên page làm tên shop hoặc suy ra shop từ bot tùy tiện. |
| INB-CTX-03 · ĐX | Nếu xem tất cả shop trong business, mỗi dòng và header phải nhận biết được shop/channel đích; hai khách cùng tên ở hai page không bị gộp. Bộ lọc bot chỉ thu hẹp tập conversation theo quy tắc liên kết được chốt ở mục 16. |
| INB-CTX-04 · ĐX | Đổi business xóa selection/bulk selection và đóng conversation không còn hợp lệ; lọc phụ thuộc phải được làm sạch hoặc khôi phục đúng business. Draft tách biệt theo user, business, channel, conversation và kiểu soạn. Quay lại business cũ không để draft xuất hiện ở khách khác. |
| INB-CTX-05 · ĐK | Channel chưa kết nối, hết quyền, mất token hoặc chưa gán bot là các tình trạng khác nhau. Chưa gán bot không tự cấm người trả lời khi channel còn hợp lệ. Có thông báo và lối vào tích hợp đúng business; quyền không đủ thì chỉ giải thích, không cho thao tác vượt quyền. |

## 5. Kênh, danh sách, tìm kiếm và bộ lọc

### 5.1 Các nhóm kênh

**INB-LST-01 · QS/ĐK:** thanh tab gồm tất cả tin nhắn, Messenger, Instagram, WhatsApp, bình luận Facebook, bình luận Instagram như tham chiếu. Rapiz chỉ mở tính năng có kết nối và adapter hỗ trợ; tab chưa hỗ trợ phải thể hiện rõ trạng thái/điều kiện, không trả danh sách giả. Zalo/website và kênh Rapiz đang hỗ trợ được giữ; vị trí bổ sung phải gọn, không làm mất phân biệt tin nhắn và bình luận.

**INB-LST-02 · QS/ĐX:** “Tất cả tin nhắn” tổng hợp các luồng tin nhắn riêng tư hợp lệ trong phạm vi hiện tại. Bình luận công khai có tab riêng, không trộn thành tin nhắn DM. Khi chuyển tab giữ bộ lọc tương thích; bộ lọc không áp dụng phải được bỏ và giải thích ngắn. Số đếm không được cộng lặp cùng conversation.

**INB-LST-03 · QS/ĐX:** mỗi dòng có avatar, tên, biểu tượng provider, channel/shop khi cần, người gửi gần nhất, preview văn bản hoặc loại media, thời gian, dấu chưa đọc, nhãn và tín hiệu trạng thái quan trọng. Dòng đang chọn dễ phân biệt; preview ghi rõ tin của nhân viên/bot/note nếu có. Không hiển thị note nội bộ cho người không có quyền.

**INB-LST-04 · ĐX:** sắp xếp mặc định theo hoạt động hội thoại mới nhất; đổi nhãn, đọc hay phân công không đẩy khách lên đầu như một tin mới. Khi khách nhắn mới, row/count cập nhật mà không kéo người đang đọc khỏi vị trí. Danh sách tải thêm không lặp hoặc mất conversation. Có trạng thái tải, rỗng, không có kết quả và lỗi có thử lại.

### 5.2 Tìm kiếm

**INB-SRC-01 · QS/ĐX:** ô tìm kiếm áp dụng trong business và các bộ lọc đang chọn. Mục tiêu tìm theo tên, điện thoại đã lưu, nội dung tin được phép truy cập. Tìm kiếm bỏ khoảng trắng thừa và không phân biệt hoa thường; việc không dấu phải được xác nhận trong task tìm kiếm, không mặc nhiên tuyên bố có. Kết quả chỉ rõ đang tìm theo tập nào. Tìm toàn lịch sử không được chỉ lọc các row đã tải.

**INB-SRC-02 · GC/ĐX:** tìm trong conversation là thao tác riêng: thấy số kết quả, chuyển trước/sau, nhảy tới tin, giữ draft. Nếu chỉ tìm lịch sử đã tải thì phải ghi rõ giới hạn; chưa được gọi là tìm toàn bộ conversation.

**INB-SRC-03 · ĐX:** phản hồi tìm kiếm cũ không được ghi đè từ khóa mới; xóa từ khóa khôi phục danh sách với bộ lọc còn hiệu lực. Không có quyền với một channel thì không được thấy snippet, tên khách hoặc count của channel đó.

### 5.3 Lọc nhanh và nâng cao

| ID | Nhóm | Nội dung |
|---|---|---|
| INB-FLT-01 · QS | Thường dùng | Chưa đọc, ưu tiên, tin trả lời quảng cáo, trao đổi thêm. “Ưu tiên” của tham chiếu cần chốt ánh xạ với dấu sao “theo dõi”; không tạo hai trường đồng nghĩa. |
| INB-FLT-02 · QS | Quảng cáo | Tập conversation bắt nguồn từ phản hồi quảng cáo; phải dựa dữ liệu nguồn có thật, không dò từ khóa quảng cáo trong nội dung. |
| INB-FLT-03 · QS | Chất lượng lead | Rất quan tâm, khá quan tâm, hơi quan tâm, không quan tâm. Tham chiếu cho chọn một mức. Cách chấm/cập nhật điểm chưa được xác nhận. |
| INB-FLT-04 · QS | Nhãn | Chọn nhiều nhãn từ thư viện đúng business. Nhãn đã xóa/không còn quyền không làm màn bị lỗi. |
| INB-FLT-05 · QS/ĐX | Người được giao | Một nhân viên cụ thể; Rapiz thêm “Tôi”, “Chưa giao” nếu chưa có trong UI tương đương. Không coi chưa giao là bot. |
| INB-FLT-06 · QS | Trạng thái/thư mục | Giao diện tham chiếu có trao đổi thêm, chưa đọc, thư mục Xong, Spam. Read state độc lập work state theo mục 6. |
| INB-FLT-07 · GC/ĐX | Bộ lọc Rapiz | Shop, channel/page, bot, bot/người xử lý, đang chờ trả lời, chờ lâu nhất, có điện thoại và saved view hiện có. Không bỏ các bộ lọc này khi làm lại UI. |
| INB-FLT-08 · QS/ĐX | Áp dụng | Bộ lọc nâng cao có Áp dụng, Xóa tất cả, đóng. Thay đổi trong form chưa áp dụng không được âm thầm tác động danh sách; đóng bỏ bản sửa. Lọc nhanh có hiệu lực ngay và thể hiện trạng thái đã chọn. |
| INB-FLT-09 · ĐX | Kết hợp | Đề xuất OR trong một nhóm, AND giữa các nhóm; nhiều nhãn mặc định “có ít nhất một nhãn đã chọn”, ghi rõ trên UI. Một mức lead dùng lựa chọn đơn. Nếu cần “đủ tất cả nhãn”, phải có tùy chọn rõ, không tự đổi ý nghĩa. |
| INB-FLT-10 · GC/ĐX | Count và view | Count lấy từ toàn tập phù hợp, không chỉ trang đang tải. Các count all/unread/waiting áp dụng mọi bộ lọc liên quan trừ tab hàng đợi đang chọn, giữ semantics hiện tại. Ví dụ trong shop A có 10 conversation phù hợp, 3 chưa đọc và 2 đang chờ: bấm tab chưa đọc chỉ hiện 3 row nhưng count vẫn 10/3/2, không biến tất cả thành 3. Bộ lọc chưa đọc do người dùng chọn riêng trong advanced filter vẫn có hiệu lực như một bộ lọc; chỉ loại trừ queue tab khỏi phép tính count. Saved view lưu bộ lọc, không lưu dữ liệu khách hoặc bulk selection. Hiện có tối đa 5 view cục bộ/user/workspace; đồng bộ dùng chung là yêu cầu mới cần task riêng. |

**Nghiệm thu điển hình:** chọn shop A + Messenger + nhân viên X + chưa đọc thì mỗi kết quả thỏa cả bốn điều kiện; page thuộc shop B không xuất hiện. Xóa tất cả lọc phụ không đổi business. Kết quả rỗng không tự chuyển về tất cả business.

## 6. Trạng thái và quy trình xử lý conversation

Các khái niệm sau phải lưu và hiển thị độc lập. Đây là quy tắc mục tiêu Rapiz, không khẳng định cấu trúc dữ liệu nội bộ của Meta.

| Khía cạnh | Giá trị mục tiêu | Không được đánh đồng với |
|---|---|---|
| Thư mục xử lý | Đang xử lý / Xong / Spam; đã xóa là trạng thái riêng nếu triển khai | Đã đọc, trạng thái đơn hàng |
| Đọc | Chưa đọc / Đã đọc | Đã trả lời, đã hoàn tất |
| Theo dõi/ưu tiên | Có / không | Trao đổi thêm, nhân viên phụ trách |
| Trao đổi thêm | Có / không; nhắc việc nếu có thời hạn riêng | Thư mục Xong hoặc trạng thái CRM |
| Người được giao | Một nhân viên đủ quyền hoặc chưa giao | Bot đang bật/tắt |
| Chế độ phản hồi | Bot / người tiếp quản tạm thời / người tiếp quản đến khi bật lại | Availability của nhân viên |
| Chờ phản hồi | Khách đã có tin chưa được phản hồi hợp lệ | Chưa đọc |
| CRM | Trạng thái customer, giai đoạn lead, chất lượng lead | Thư mục xử lý conversation |
| Thương mại | Dấu mốc đã đặt hàng/đã thanh toán/đã vận chuyển/đã đặt lịch hoặc order thật | Đã thanh toán thực tế chỉ vì bấm một nhãn |

| ID | Quy tắc và nghiệm thu |
|---|---|
| INB-STA-01 · GC/ĐX | Mở conversation và tải được phần tin chưa đọc mới đánh dấu đã đọc; chỉ preview/hover không đánh dấu. Rapiz hiện dùng trạng thái đọc chung trong workspace; giữ cách này trong đợt đầu, không tự chuyển sang trạng thái riêng mỗi nhân viên. Tự đánh dấu chưa đọc phải tồn tại sau khi thao tác, không bị vòng cập nhật xóa ngay. |
| INB-STA-02 · QS/ĐX | Hoàn tất chuyển conversation sang Xong, bỏ khỏi hàng đợi đang xử lý nhưng không xóa lịch sử, customer, nhãn hay draft. Có thao tác mở lại. Đề xuất tin khách mới mở lại conversation Xong; không tự đưa Spam trở lại hàng đợi chính. Tin note nội bộ không mở lại Xong. |
| INB-STA-03 · QS/ĐX | Chuyển Spam tách khỏi hàng đợi chính; có xem Spam và khôi phục về đang xử lý. Khôi phục không gửi tin tự động và không mở bot ngoài ý muốn. |
| INB-STA-04 · QS/ĐK | Xóa phải có xác nhận, nêu rõ phạm vi xóa ở Rapiz hay trên nền tảng và khả năng khôi phục. Không xem Xong là xóa. Chưa chốt retention/restore và quyền provider thì chưa triển khai thao tác xóa thật. Không cam kết xóa tin phía khách. |
| INB-STA-05 · QS/ĐX | Dấu sao theo dõi có thể bật/tắt mà không đổi read state hoặc thư mục; filter phải khớp. Trao đổi thêm là cờ riêng nếu được chủ sản phẩm xác nhận khác theo dõi. |
| INB-STA-06 · GC/ĐX | Chờ phản hồi bắt đầu từ tin khách chưa được trả lời; đọc, giao người, gắn nhãn và note không xóa thời gian chờ. Bot/người gửi phản hồi thành công kết thúc lượt chờ; gửi thất bại không được làm mất khỏi hàng đợi cần trả lời. Thời điểm dùng để tính phải được định nghĩa nhất quán với metric. |
| INB-STA-07 · ĐX | Hai nhân viên cập nhật cùng lúc: không âm thầm ghi đè dữ liệu mới bằng màn cũ. Thông báo xung đột, tải trạng thái mới, giữ draft và cho người dùng thử lại có chủ ý. |

### Chính sách gửi theo thư mục — đề xuất cần duyệt

Bảng này áp dụng thêm vào quyền, policy provider, trạng thái channel, bot và human takeover. Đủ điều kiện ở một dòng không thay thế các kiểm tra đó.

| Thư mục hiện tại | Tin vào và read state | Chờ phản hồi/thông báo | Nhân viên gửi | Bot và automation gửi |
|---|---|---|---|---|
| Đang xử lý | Nhận/lưu tin hợp lệ, cập nhật chưa đọc theo quy tắc chung | Waiting theo tin khách chưa được trả lời; thông báo theo quyền và tùy chọn | Cho phép khi đủ quyền/policy | Chỉ khi bot/rule đủ điều kiện và không bị tiếp quản |
| Xong | Tin khách mới hợp lệ mở lại về đang xử lý và đặt chưa đọc; note/event nội bộ không mở lại | Lượt chờ mới sau reopen; có thông báo tin khách theo tùy chọn | Phải mở lại trước, không âm thầm gửi từ thư mục Xong | Không gửi khi vẫn ở Xong; chỉ xét lại sau tin khách đã mở lại và còn đủ điều kiện |
| Spam | Tiếp tục tiếp nhận theo hợp đồng provider, giữ trong Spam; có thể có unread trong Spam | Không vào waiting hàng đợi chính, mặc định không thông báo tin mới | Khôi phục về đang xử lý trước khi trả lời | Chặn gửi tự động và job gửi đã xếp hàng; không tự khôi phục vì tin mới |
| Đã xóa | Quy tắc giữ/xóa tin vào, unread và phục hồi chưa chốt retention/provider contract; đây là discovery gate | Không đưa vào hàng đợi/thông báo như conversation đang xử lý | Không gửi từ đối tượng đã xóa | Chặn gửi mới và job cũ; chưa triển khai xóa thật trước khi chốt vòng đời dữ liệu |

**INB-STA-08 · ĐX:** trước khi gửi từ job đã xếp hàng phải kiểm tra lại thư mục, quyền, takeover, trạng thái rule/bot và policy kênh. Chuyển Spam/Xong/xóa phải ngăn lần gửi chưa thực hiện; không thể thu hồi tự động một tin provider đã nhận trước khi đổi trạng thái. Khôi phục/reopen không replay tin cũ hay kích hoạt lại job gửi đã bị hủy. Rule chỉ tổ chức nội bộ không được dùng như đường vòng để tự gửi.

### Phân công và xử lý hàng loạt

**INB-ASG-01 · QS/ĐX:** header mở menu tại nút phân công, danh sách nhân viên được phép truy cập đúng business/channel, chọn một người rồi xác nhận; có bỏ giao. Thành công cập nhật header, row và filter. Người bị thu hồi quyền không còn là lựa chọn hợp lệ. Nếu người nhận không có quyền với một số conversation, báo rõ từng phần không thể giao.

**INB-ASG-02 · ĐX:** gán người không tự gửi tin hoặc bật/tắt bot. Tự nhận việc một lần bấm có thể bổ sung như tiện ích Rapiz, không ghi là Meta đã quan sát. Chuyển giao phải có lịch sử người thực hiện, người nhận và thời điểm.

**INB-BLK-01 · QS:** “Quản lý” bật checkbox và thanh thao tác; hủy thoát selection. Có chọn tất cả **đang hiển thị**, số được chọn rõ. Danh mục quan sát: chuyển Xong, đánh dấu theo dõi, xóa conversation, gỡ trao đổi thêm, đã đọc/chưa đọc, Spam, phân công.

**INB-BLK-02 · ĐX:** không tự chọn toàn bộ kết quả chưa tải. Đổi business/filter/tab thì xóa selection và cho biết lý do. Mỗi thao tác hàng loạt báo tổng thành công/thất bại, lỗi gắn từng conversation; thử lại chỉ các mục thất bại và không chạy lại phần đã thành công. Xóa cần xác nhận số lượng/phạm vi. Không được tạo hàng loạt tin nhắn từ nút xử lý trạng thái.

## 7. Lịch sử trao đổi và soạn tin

### 7.1 Đọc lịch sử

**INB-MSG-01 · QS/GC:** bubble vào/ra tách rõ, avatar và người gửi khi cần, phân biệt bot/nhân viên; mốc ngày, thời gian, nội dung đa dòng, link, emoji, media và trạng thái gửi/đọc theo dữ liệu thật. Event hệ thống và note có kiểu hiển thị riêng, không giả làm tin khách.

**INB-MSG-02 · GC/ĐX:** tải tin cũ giữ vị trí đang đọc; nhận tin mới khi đang ở trên không kéo xuống, hiện chỉ báo và nút tới tin mới nhất. Quay lại conversation khôi phục vị trí phù hợp. Media tải chậm không làm nhảy mất tin. Tin không hỗ trợ, bị thu hồi hoặc không còn truy cập phải có placeholder giải thích.

**INB-MSG-03 · QS/ĐK:** hiển thị reaction và dấu đã xem nếu kênh cung cấp. Danh mục cần xác minh menu từng tin: trả lời một tin cụ thể, reaction, sao chép, xem bản gốc, thu hồi/xóa/chuyển tiếp. Chưa quan sát menu trong tài khoản tham chiếu; không bắt Claude giả lập tất cả trên mọi provider. Mỗi hành động chỉ mở khi capability cho phép, có trạng thái lỗi/không đủ quyền.

### 7.2 Composer

| ID | Chức năng | Quy tắc nghiệm thu |
|---|---|---|
| INB-CMP-01 · QS/GC | Đúng danh tính gửi | Cho biết channel/page và customer đích. Gửi trong business/channel của conversation hiện tại, không theo một page được chọn trước đó ở màn khác. |
| INB-CMP-02 · QS/ĐX | Nhập và gửi | Văn bản, xuống dòng, emoji; nút gửi rõ. Enter theo cài đặt cá nhân, Shift+Enter xuống dòng; khi bộ gõ tiếng Việt đang xác nhận ký tự thì không gửi nhầm. Văn bản trống không gửi; media hợp lệ có thể gửi không caption nếu provider cho phép. |
| INB-CMP-03 · GC/ĐX | Draft | Giữ draft khi đổi conversation/tab/khu vực làm việc. Mục tiêu có khôi phục sau refresh theo chính sách được duyệt; hiện tại chỉ giữ trong phiên/tab. Reply công khai, DM, note có draft riêng, không chuyển nhầm nội dung note ra ngoài. |
| INB-CMP-04 · QS/ĐK | Media/file | Paperclip mở chọn file hoặc thư viện phù hợp; preview, tên/kích thước, caption, bỏ file trước khi gửi, tiến độ, lỗi/huỷ upload. Loại, số lượng và giới hạn dựa channel; không mặc định mọi kênh hỗ trợ cùng một tập. Giữ khả năng chèn HTTPS/media library hiện có. |
| INB-CMP-05 · QS/GC | Trả lời lưu sẵn | Mở tại composer, tìm/chọn mẫu, chèn vào vị trí con trỏ để sửa trước khi gửi. Có tên, nội dung, shortcut; biến tên khách/page chỉ thay khi có giá trị, thiếu phải cảnh báo hoặc để trống theo quy tắc mẫu. Tham chiếu quảng bá tên/link/ảnh và shortcut; quản lý CRUD và ảnh cần xác minh chi tiết. Không tự gửi khi chọn mẫu. |
| INB-CMP-06 · QS/ĐK | Emoji và gửi nhanh | Emoji chèn vào draft. Nút thumbs-up gửi nhanh là hành động gửi thật, phải có nhãn rõ và chỉ hoạt động khi đủ quyền. Cách ngăn gửi nhầm khi có draft cần thiết kế trước nghiệm thu. Không coi click icon trang trí là đã hỗ trợ reaction. |
| INB-CMP-07 · GC | Note nội bộ | Chuyển chế độ hiển thị rõ “Ghi chú nội bộ”; lưu author/time và nội dung, không gửi provider, không xóa trạng thái chờ phản hồi của khách. Note không được hiện trong chat bên khách hoặc mẫu trả lời công khai. |
| INB-CMP-08 · GC | Sản phẩm | Chọn sản phẩm/variant đúng business/shop, tồn kho và giá hiện tại nếu có nguồn thật. Chèn thông tin/link/media vào draft, cho sửa và gửi có chủ ý. Không tự tạo order hoặc cam kết còn hàng vì đã chọn sản phẩm. |
| INB-CMP-09 · ĐK | Giao dịch/công cụ thương mại | Icon thương mại trong tham chiếu cần xác minh hành vi; không suy diễn là cổng thanh toán đầy đủ. Tạo order/đặt lịch/payment link phải theo ngành, module thật và quyền hợp lệ. |
| INB-CMP-10 · ĐX | Policy gửi | Khi token hết hạn, người dùng mất quyền, hết cửa sổ nhắn tin hoặc thiếu opt-in: khóa hành động tương ứng, lý do rõ và hướng xử lý. Draft vẫn giữ. Không dùng bot hoặc mẫu để vượt giới hạn provider. |

**INB-SEND-01 · GC/ĐX:** mỗi lần gửi có trạng thái đang gửi → đã gửi hoặc thất bại/chưa rõ kết quả. Delivered/read chỉ hiện khi provider xác nhận. Lỗi chắc chắn chưa gửi cho thử lại; timeout không rõ kết quả phải đối soát, không tạo thêm bản tin vì người dùng bấm lại. Click liên tiếp không sinh tin trùng. Thành công mới xóa phần draft đã gửi; nội dung gõ thêm trong lúc gửi không bị xóa.

**INB-SEND-02 · ĐX:** nhiều tab/nhân viên cùng xử lý phải cập nhật lịch sử và danh tính người gửi, không lặp tin do nhận webhook sau optimistic update. Có cảnh báo đang có người khác xử lý nếu có năng lực presence thật; không dựng trạng thái “đang gõ” giả.

## 8. Bình luận Facebook và Instagram

Tab bình luận đã quan sát; luồng chi tiết chưa kiểm chứng trên tài khoản này để tránh tác động dữ liệu. Các yêu cầu sau là mục tiêu ĐK và phải được xác nhận bằng kênh thử nghiệm có quyền.

- **INB-COM-01:** danh sách theo page/tài khoản, bài viết/quảng cáo và luồng comment. Hiển thị bài gốc hoặc preview đủ ngữ cảnh, tác giả, thời điểm, comment cha/con; có mở bài trên nền tảng. Không dựng comment thành DM không có nguồn gốc.
- **INB-COM-02:** trả lời công khai đúng comment và đúng danh tính page. Composer ghi rõ “Trả lời công khai”; cancel giữ/loại draft theo lựa chọn. Không đưa số điện thoại hoặc note nội bộ lên comment do đổi chế độ.
- **INB-COM-03:** trả lời riêng từ comment khi provider cho phép, ghi rõ người nhận, giới hạn và trạng thái gửi; đánh dấu đã gửi private reply để tránh gửi trùng. Comment, private reply và DM sau đó có liên kết nguồn, không tự gộp mọi danh tính theo tên.
- **INB-COM-04:** thích/bỏ thích, ẩn/bỏ ẩn, xóa và báo cáo theo capability thực tế; xóa có xác nhận và lỗi quyền. Không hứa tất cả Facebook/Instagram có thao tác như nhau.
- **INB-COM-05:** lọc chưa xử lý, phân công, nhãn và hoàn tất có quy tắc rõ ở cấp luồng; phản hồi mới cập nhật danh sách. Chốt cấp trạng thái là một comment hay một post-thread trước khi triển khai.
- **INB-COM-06:** đồng bộ comment bị xóa/ẩn từ nền tảng và lỗi quyền; không mất dữ liệu DM liên quan. Không thực thi comment-to-DM nếu đã chạy cùng rule/event hoặc không còn đủ điều kiện.

**Điểm bắt buộc:** được bình luận không tự đồng nghĩa đã được phép nhắn tin tùy ý. Cửa sổ gửi, số lần private reply, quyền và loại nội dung phải xác minh theo provider/API version đang dùng trước khi bật. Không chép một con số chính sách chưa được kiểm chứng vào business rule cố định.

## 9. Hồ sơ khách hàng bên phải

| ID | Chức năng | Yêu cầu và nghiệm thu |
|---|---|---|
| INB-CRM-01 · QS/GC | Nhận diện | Avatar, tên, provider, liên kết profile khi hợp lệ; thu gọn/mở panel. Không suy ra cùng customer chỉ từ tên/avatar. Chọn/link CRM có chủ ý và có quyền; thấy rõ nếu chưa liên kết. |
| INB-CRM-02 · QS/ĐX | Thông tin liên hệ | Chỉnh phone + mã quốc gia, email, ngày/tháng sinh, địa chỉ, thành phố, tỉnh/bang và mã bưu chính theo tham chiếu; trường hợp Việt Nam trình bày gọn theo nhu cầu. Trường không bắt buộc không ép nhập. Kiểm tra định dạng, không tự ghi đè thông tin staff xác nhận bằng dữ liệu trích xuất từ chat. Lưu/cancel rõ, báo lỗi tại trường. |
| INB-CRM-03 · QS/ĐK | Profile nền tảng | Chỉ hiển thị trường công khai/provider thực sự trả và được phép dùng: múi giờ, thích page, nơi sống… Không cào profile cá nhân để bắt chước UI Meta. Thiếu thì ẩn hoặc ghi chưa có, không tạo dữ liệu mẫu. |
| INB-CRM-04 · QS/ĐX | Lead | Có đánh dấu lead và hiển thị giai đoạn. Chất lượng lead khác giai đoạn và khác trạng thái customer. Đường sang quản lý lead/CRM giữ business, shop và đúng customer; không tạo hồ sơ trùng mỗi lần bấm. Danh sách giai đoạn phải dùng nguồn chuẩn được duyệt, không tự đặt theo suy đoán. |
| INB-CRM-05 · QS/ĐX | Dấu mốc thương mại | Tham chiếu có đã đặt hàng, đã thanh toán, đã vận chuyển, đã đặt lịch và xóa trạng thái. Phải phân biệt dấu mốc ghi nhận thủ công với order/payment thật; đánh dấu “đã thanh toán” không tạo giao dịch hay cộng doanh thu. Nếu lấy từ order thật thì hiển thị nguồn và không cho sửa giả trạng thái tài chính từ dropdown này. |
| INB-CRM-06 · QS/GC | Nhãn | Xem nhãn đang gắn, tìm/chọn nhiều nhãn, gỡ từng nhãn, gợi ý nếu có rule rõ. Dùng thư viện chuẩn của “Cài đặt khách hàng” trong business, không tạo thư viện thứ hai ở Inbox. Nhãn yêu cầu giá trị phải nhập/validate đầy đủ trước lưu. Lỗi lưu giữ form và trả lại UI trạng thái cũ, không báo thành công giả. |
| INB-CRM-07 · ĐX | Phạm vi nhãn | Nhãn conversation hiện có và nhãn customer không tự đồng nhất. UI phải ghi rõ đang gắn vào hội thoại hay hồ sơ; nếu muốn dùng một bộ chung phải có quyết định chuyển đổi và kiểm tra mọi conversation liên quan. Không tự lan nhãn từ shop/business này sang nơi khác. |
| INB-CRM-08 · QS/ĐX | Ghi chú hồ sơ | Thêm ghi chú, tác giả/thời gian, danh sách lịch sử. Baseline Rapiz chỉ có notes theo conversation. Đợt đầu panel hiển thị cùng nguồn conversation notes, ghi rõ phạm vi; đây không phải hai bản sao cần đồng bộ. Note riêng của hồ sơ customer là năng lực mới, chỉ nhận triển khai khi chốt nguồn chuẩn và quyền; không được coi đã có. Chỉnh/xóa chỉ mở khi có quyền và capability thực tế, có audit, không làm mất note người khác do save form cũ. |
| INB-CRM-09 · QS/ĐK | Hoạt động và consent | Timeline có sự kiện nguồn thật. Checkbox chia sẻ dữ liệu/đo lường quảng cáo của Meta không được sao chép thành cơ chế consent giả của Rapiz. Mặc định không bật tính năng gửi dữ liệu sang Meta; nếu tích hợp thì xác định mục đích, quyền, người thay đổi, trạng thái thực và đường quản lý trước. |
| INB-CRM-10 · QS/ĐX | Nội dung chia sẻ | Grid ảnh và danh sách file/link theo conversation được phép xem, mở preview, chuyển ảnh, tải khi hợp lệ. Nội dung chưa tải, lỗi, bị gỡ và không hỗ trợ có trạng thái riêng. Không gọi những ảnh đang có trong client là toàn bộ ảnh lịch sử nếu chưa phân trang đủ. |
| INB-CRM-11 · GC/ĐX | Order/đặt lịch | Giữ tạo draft order thật ngay trong Inbox, có customer, sản phẩm/variant, tổng tiền, nguồn conversation/shop. Gửi lại không tạo order trùng. Danh sách lịch sử phải lấy order liên kết thật; danh sách “tạo trong phiên này” không được đổi tên thành “mọi đơn của khách”. Ngành khách sạn/đặt lịch dùng đối tượng phù hợp, không ép mọi business thành thương mại điện tử. |
| INB-CRM-12 · QS/ĐK | Dừng liên lạc/báo cáo | Menu khách tham chiếu có dừng liên lạc và báo cáo. Phải xác minh nghĩa là block provider hay stop-contact nội bộ, quyền, thời hạn, hoàn tác và tác động bot trước triển khai. Không coi tắt bot là chặn khách. |

## 10. Công việc, availability, tự động hóa và cài đặt

### 10.1 Availability và công việc

**INB-OPS-01 · QS/ĐX:** menu tại header có đang có mặt/vắng mặt; tham chiếu giải thích ảnh hưởng thông báo và response rate, có lối thêm tin vắng mặt. Rapiz phải nói rõ đây là trạng thái cá nhân, shop hay channel; đề xuất presence cá nhân riêng, lịch vắng mặt channel riêng. Không bấm đổi presence rồi âm thầm tắt bot toàn business.

**INB-OPS-02 · QS/ĐK:** “Việc cần làm” là entry quan sát được, nội dung chưa xác minh. Mục tiêu Rapiz: xem việc của mình/chưa giao/quá hạn; mở đúng conversation với quyền hiện tại. Nhắc trao đổi thêm có người chịu trách nhiệm, thời hạn và múi giờ, trạng thái hoàn thành/hủy. Hiện Rapiz lưu thời điểm follow-up nhưng chưa có scheduler gửi nhắc; UI không được hứa notification nền khi chưa có worker thực hiện.

**INB-OPS-03 · ĐX/ĐK:** thông báo tin mới, được phân công và nhắc việc phải đi đúng người có quyền; tắt thông báo cá nhân không dừng nhận tin/bot. Nếu dùng browser notification, xin quyền tại thời điểm có ngữ cảnh và có trạng thái bị chặn. Người dùng quay lại notification không được mở dữ liệu business không còn quyền.

### 10.2 Tự động hóa

Đã quan sát thư viện mẫu, tìm kiếm theo tên/mục tiêu, trạng thái bật/tắt, kênh áp dụng và nút chỉnh sửa. Không bật/sửa/publish automation nào trong khảo sát. Danh mục đầy đủ nhìn thấy gồm:

| ID | Mẫu | Quy tắc mục tiêu ĐX/ĐK |
|---|---|---|
| INB-AUT-01 | Chào/trả lời tức thì | Trigger khởi đầu hợp lệ, phạm vi channel, nội dung, điều kiện “lần đầu” được định nghĩa; không chào lại mỗi webhook. |
| INB-AUT-02 | Tin vắng mặt | Lịch, múi giờ, nội dung và kênh. Phân biệt vắng mặt channel với nhân viên offline; có giới hạn lặp. |
| INB-AUT-03 | Câu hỏi thường gặp | Quản lý câu hỏi/câu trả lời, thứ tự và kênh; lựa chọn từ người dùng tạo đúng trả lời nếu provider hỗ trợ. |
| INB-AUT-04 | Vị trí | Lấy nguồn địa chỉ đúng shop; không dùng địa chỉ business khác. |
| INB-AUT-05 | Thông tin liên hệ | Nội dung từ thông tin được cấu hình, không lộ thông tin cá nhân staff. |
| INB-AUT-06 | Giờ hoạt động | Lịch theo shop/channel và timezone, có cách xử lý ngày nghỉ; không tự suy giờ từ availability một nhân viên. |
| INB-AUT-07 | Từ khóa tùy chỉnh | Quy định cách khớp từ/cụm, phân biệt dấu/hoa thường, loại sự kiện và tránh kích hoạt từ tin của chính bot/nhân viên. |
| INB-AUT-08 | Bình luận để nhắn tin | Post/comment nguồn, từ khóa, nội dung private reply, điều kiện provider, chống trùng; không tự biến thành broadcast. |
| INB-AUT-09 | Xác định tin chưa trả lời | Thời gian chờ, loại phản hồi được tính, hành động gắn cờ/nhắc/giao việc; không tự gửi lời hứa cho khách nếu rule chỉ nhằm sắp xếp. |
| INB-AUT-10 | Tạo từ đầu | Danh mục entry đã thấy; khả năng builder chưa khảo sát. Muốn triển khai phải có tập trigger, condition, action, validation cụ thể; không bắt Claude tự sáng tạo một workflow engine tổng quát. |

**INB-AUT-11 · ĐX:** mỗi rule có tên, mục tiêu, phạm vi, điều kiện, hành động, nội dung, trạng thái và người sửa. Có tạo/chỉnh/bật/tắt theo quyền, preview và test không gửi khách thật. Save draft và publish phải rõ; thay đổi form chưa publish không ảnh hưởng rule chạy. Luật mâu thuẫn phải được cảnh báo; thứ tự ưu tiên với bot, human takeover và automation của Meta phải được quyết định trước khi bật gửi tự động.

**INB-AUT-12 · ĐX:** cùng event chỉ chạy hành động gửi một lần; lỗi có lịch sử và retry an toàn. Rule bị tắt không phát sinh lần gửi mới từ job cũ. Khi nhân viên đang tiếp quản, mặc định chặn rule gửi tự động trừ rule được cấu hình rõ; các tác vụ tổ chức nội bộ có thể tiếp tục. Không chồng lời chào của Rapiz và Meta nếu cả hai cùng hoạt động.

### 10.3 Cài đặt Inbox

| ID | Mục đã quan sát | Yêu cầu mục tiêu |
|---|---|---|
| INB-SET-01 · QS/ĐK | URL Messenger + sao chép | Hiển thị link đúng page/channel, copy và báo thành công, không lộ credential. Link của provider khác chỉ có khi thật sự hỗ trợ. |
| INB-SET-02 · QS/ĐX | Return/Enter để gửi | Tùy chọn cá nhân trong Rapiz; quy tắc composer khớp cài đặt, mặc định và lưu phải rõ. Không ảnh hưởng nhân viên khác. Scope cá nhân là đề xuất, chưa khẳng định scope Meta. |
| INB-SET-03 · QS/ĐK | Gợi ý trả lời DM/bình luận | Có bật/tắt riêng theo loại nguồn, chèn gợi ý để người duyệt, không tự gửi; chỉ dùng dữ liệu business được phép truy cập. Gợi ý sai/hết dữ liệu có thể bỏ qua. |
| INB-SET-04 · QS/ĐK | Gợi ý hành động order/thanh toán | Hiện đúng chức năng thật, có preview/đồng ý trước tạo đối tượng; tắt gợi ý không xóa dữ liệu. |
| INB-SET-05 · QS/ĐK | Gợi ý công cụ mẫu trả lời/FAQ | Liên kết đúng thư viện/rule; không tự đổi template đã publish. |
| INB-SET-06 · QS/ĐK | Cuộc gọi | Tham chiếu có gọi vào/ra, thông báo chuông desktop và lịch giờ gọi. Gọi ra nêu điều kiện khách đồng ý nhận cuộc gọi. Phải khảo sát quyền, consent, provider support và handling cuộc gọi/nhỡ/từ chối riêng; không mở nút gọi trong Rapiz khi chưa có tích hợp. Không triển khai hoặc thực hiện cuộc gọi trong task spec. |
| INB-SET-07 · QS/ĐK | Tăng số tin nhắn | Lối vào dùng bài có sẵn hoặc tạo bài/quảng cáo click-to-message. Phạm vi Inbox chỉ gồm entry và đưa đúng channel sang module/quy trình hỗ trợ; mua quảng cáo/publish nằm ngoài task. Không sao chép số dự báo chi phí/kết quả trên tài khoản tham chiếu làm số thật Rapiz. |

## 11. Báo cáo và quản lý lead liền kề

**INB-REP-01 · QS/ĐX:** icon biểu đồ dẫn tới báo cáo nhắn tin; tham chiếu có chọn nền tảng, khoảng ngày, các nhóm tổng/new/returning/đã đặt hàng và organic/paid. Với Rapiz dẫn về thống kê phù hợp của business hiện tại, không thiết kế lại dashboard ngoài scope. Mỗi metric phải có định nghĩa nguồn, phạm vi, timezone, khử trùng lặp và trạng thái chưa có dữ liệu. Không nhầm số tin, số conversation và số customer; chưa đủ nguồn thì hiện chưa hỗ trợ, không hiện 0 giả.

**INB-LEAD-01 · QS/ĐK:** tab “Khách hàng tiềm năng” cạnh tab tin nhắn là entry đã thấy; màn và pipeline chưa khảo sát sâu. Mục tiêu liên kết module CRM/lead cùng business/shop/customer; giữ ngữ cảnh quay về Inbox và tránh tạo lead trùng. Danh mục stage, quality scoring, xuất/nhập và automation pipeline phải khảo sát hoặc lấy spec CRM riêng trước khi nhận scope; không tự coi mọi tính năng CRM Meta đã được đặc tả ở đây.

## 12. Phần riêng Rapiz phải giữ

Đây là yêu cầu Rapiz, không phải tính năng đã xác nhận của Meta.

- **INB-RPZ-01:** hiển thị bot nào gắn channel/shop và bot/người đã gửi từng tin. Gán bot, bật bot toàn cục và người đang được giao là ba thao tác khác nhau.
- **INB-RPZ-02:** tiếp quản tạm thời có thời điểm hết hạn rõ; tiếp quản đến khi bật lại không tự hết hạn. Cho biết ai tiếp quản, cách trả về bot; không làm mất assignment nhân viên.
- **INB-RPZ-03:** khi người tiếp quản, tác vụ bot đang chờ không được gửi muộn đè lên câu trả lời người; tác vụ đã gửi trước đó vẫn hiển thị đúng. Trả về bot không tự replay toàn bộ tin cũ như tin mới.
- **INB-RPZ-04:** trường hợp bot bị tắt ở quản lý bot, mất channel hoặc hết quota phải có lý do riêng; “trả về bot” không tự bật bot toàn cục/khôi phục token/mua thêm gói. Staff trả lời theo quyền và policy kênh; cách tính quota cần dùng quy tắc account đã duyệt, không tự đặt ở Inbox.
- **INB-RPZ-05:** giữ nguồn sản phẩm, dữ liệu CRM, draft order, template, nhãn bắt buộc giá trị, saved view và retry an toàn. Không cắt bỏ chức năng đã chạy chỉ để giao diện gần Meta hơn.

## 13. Luồng nghiệp vụ chuẩn

### F01 — Nhận và trả lời tin mới

1. Nhân viên vào Inbox trong business đang chọn, thấy tin mới của shop/channel hợp lệ.
2. Chọn conversation; lịch sử tải và trạng thái đọc cập nhật, thông tin khách đúng bên phải.
3. Nếu bot đang xử lý, người dùng tiếp quản theo chính sách; chọn mẫu hoặc soạn và đính kèm.
4. Kiểm tra người nhận/kênh, gửi; UI thể hiện đang gửi và kết quả thật.
5. Nếu thành công, cập nhật preview và trạng thái chờ; nếu lỗi, giữ draft và hướng retry an toàn. Hoàn tất chỉ do thao tác/quy tắc được duyệt, không mặc nhiên vì đã gửi một tin.

### F02 — Giao việc và theo dõi

Lọc chưa giao hoặc chưa trả lời → chọn một/nhiều conversation → chọn nhân viên đủ quyền → xác nhận → thấy kết quả từng mục. Người nhận mở đúng việc; thêm follow-up có thời hạn nếu cần; hoàn tất không xóa ghi chú. Quá hạn phải phân biệt với chưa đọc. Nhắc nền chỉ nghiệm thu khi có cơ chế chạy thật.

### F03 — Gắn nhãn và cập nhật khách

Mở panel → xác định customer đã link hay chưa → chọn nhãn từ thư viện → nếu bắt buộc giá trị thì nhập trước lưu → kết quả hiển thị thống nhất theo phạm vi nhãn. Chỉnh số điện thoại/ghi chú có lưu/cancel. Lỗi mạng không làm mất form hoặc thay dữ liệu khác của khách.

### F04 — Xử lý comment và chuyển riêng tư

Mở tab bình luận → chọn luồng → thấy post gốc → chọn trả lời công khai hoặc riêng tư một cách rõ ràng → hệ thống kiểm tra quyền/chính sách → gửi đúng nơi → liên kết nguồn và chống gửi trùng. Chuyển private reply không tự cho phép bot nhắn tiếp vô hạn.

### F05 — Đổi business khi đang soạn

Đang soạn ở business A → đổi sidebar sang B → mọi list/count/customer/channel đổi sang B, không hiển thị draft A → vào lại A thấy draft của đúng conversation theo chính sách lưu. Bulk selection cũ bị xóa; phản hồi request cũ của A không được chèn vào màn B.

### F06 — Hoàn tất, Spam và khôi phục

Hoàn tất → rời hàng đợi đang xử lý, còn lịch sử trong Xong → mở lại về đang xử lý. Spam → chỉ có trong khu vực Spam → khôi phục có chủ ý. Tin mới vào Xong mở lại theo quy tắc đã duyệt; Spam không tự hồi phục. Xóa là luồng có xác nhận riêng, không dùng thay hoàn tất.

## 14. Hiện trạng Rapiz và khoảng cách

Đối chiếu baseline main `9265c3c` cùng tài liệu Inbox hiện hành. Đây là phân tích phạm vi, không phải chứng nhận chạy thử tất cả chức năng trong phiên này.

| Đã có nền tảng — cần giữ và kiểm thử hồi quy | Khoảng cách/giới hạn cần task riêng |
|---|---|
| Inbox nhiều vùng, tab all/unread/waiting, phân công, đọc/chưa đọc chung workspace | Full Meta-like layout/menus, bulk actions và toàn bộ filter parity chưa được coi là đã có |
| Read state, customer phone, note có author/time, bot takeover, sender attribution | Chốt business/shop/channel/bot mapping với lane A; chưa thể làm filter shop thật chỉ bằng đổi nhãn |
| Saved view local tối đa 5, tìm trong phần thread đã tải, giữ vị trí, quick replies | Saved view đồng bộ server, tìm toàn lịch sử, persistent draft sau reload là mở rộng |
| Draft theo phiên/tab, gửi/retry với chống trùng, HTTPS/media library | Upload file trực tiếp có progress/cancel và capability validation là phần cần bổ sung |
| Link CRM có chủ ý, tag yêu cầu giá trị, form tạo draft order thật | Full customer order history khác danh sách order tạo trong phiên; customer/conversation tag scope phải chốt |
| Lưu follow-up UTC, polling | Chưa có scheduler nhắc nền; presence/typing/realtime cần nguồn thật |
| Facebook comment integration có tài liệu riêng | Không mặc định nó đã bao phủ mọi hành vi INB-COM-01…06 hoặc Instagram comment parity |

Việc “có nền tảng” không miễn nghiệm thu UI mới, quyền và các trường hợp cạnh tranh. Đọc thêm tài liệu hiện trạng ở bản handoff tiếng Anh liên kết cuối tài liệu.

## 15. Điều kiện chất lượng và nghiệm thu

### 15.1 Yêu cầu chung

- **INB-NFR-01:** mọi dữ liệu, count, tìm kiếm, file, mutation và deep link đều kiểm tra business/workspace/channel permission; không chỉ lọc phía giao diện. Thu hồi quyền trong lúc mở màn phải dừng đọc/gửi tiếp.
- **INB-NFR-02:** loading, rỗng, lỗi, mất kết nối và chưa có quyền là trạng thái khác nhau. Lỗi panel khách không được làm mất draft; lỗi gửi không được báo hoàn tất thành công. Có retry đúng phần lỗi, không reload toàn trang như cách xử lý mặc định.
- **INB-NFR-03:** dữ liệu mới cập nhật không trùng, không đổi nhầm selection, không làm nhảy scroll; đồng hồ/timezone rõ cho lịch và follow-up. Không tự đặt SLA latency mới; dùng performance budget repo và chốt cadence refresh trong task kỹ thuật.
- **INB-NFR-04:** hỗ trợ bàn phím, focus trở về nút mở sau đóng menu, tên accessibility, contrast, thông báo lỗi và mobile. Text/nút đọc được ở 100% zoom, không giảm font toàn app để nhét cột.
- **INB-NFR-05:** ghi audit với người, thời gian, đối tượng, loại thao tác và kết quả cho phân công, thay trạng thái, cấu hình automation, stop-contact và thao tác phá hủy. Không ghi toàn bộ tin hoặc thông tin liên hệ vào log kỹ thuật không cần thiết.
- **INB-NFR-06:** các thao tác gửi/bulk/order/automation chống chạy trùng và có trạng thái đối soát khi chưa rõ kết quả. Tiền/đơn hàng/payment dùng nguồn chuẩn, không tạo doanh thu từ thao tác đánh dấu giao diện.

### 15.2 Bộ tình huống nghiệm thu bắt buộc

| ID | Tình huống | Kết quả đạt |
|---|---|---|
| INB-AT-01 | Hai business có cùng tên khách; đổi business khi request cũ chưa xong | Không rò dữ liệu, count, draft, selection hoặc snippet |
| INB-AT-02 | Hai shop cùng bot hoặc nhiều channel trong một shop | Shop filter đúng liên kết thật; không nhầm bot = shop |
| INB-AT-03 | Lọc đồng thời shop/channel/read/assignee/nhãn | Đúng quy tắc kết hợp, count toàn tập, clear không đổi business |
| INB-AT-04 | Đọc rồi đánh dấu chưa đọc; đã đọc nhưng chưa trả lời | Hai trạng thái độc lập, waiting không mất vì đọc |
| INB-AT-05 | Hoàn tất/Spam rồi có tin mới | Reopen theo quy tắc Xong; không tự hồi Spam; lịch sử còn |
| INB-AT-06 | Bulk trên phần danh sách đã tải, một mục không có quyền | Phạm vi chọn rõ, báo partial failure, không retry phần thành công |
| INB-AT-07 | Hai người phân công/đổi status cùng lúc | Không ghi đè im lặng; giữ draft và giải quyết xung đột |
| INB-AT-08 | Gửi rồi timeout/nhận webhook muộn/click kép | Không gửi trùng; phân biệt failed và unknown |
| INB-AT-09 | Gõ thêm trong lúc gửi; đổi thread/tab rồi quay lại | Không mất phần mới, không gửi cho khách khác |
| INB-AT-10 | File sai loại/quá lớn/upload lỗi/token hết hạn | Lý do rõ, không mất text draft, không báo đã gửi |
| INB-AT-11 | Đổi note nội bộ ↔ reply ↔ comment công khai | Nội dung không rò sang chế độ/khách khác |
| INB-AT-12 | Nhãn thiếu giá trị bắt buộc hoặc save lỗi | Không lưu một phần sai; giữ form, filter theo dữ liệu chuẩn |
| INB-AT-13 | Customer trùng tên/phone chưa xác nhận | Không tự merge; link có chủ ý, thông tin staff không bị đè |
| INB-AT-14 | Human takeover khi bot đang chờ gửi | Bot không gửi muộn; kiểm tra cả chuyển Xong/Spam khi có job chờ; resume không replay tin cũ |
| INB-AT-15 | Comment private reply hết điều kiện hoặc đã gửi | Chặn/hướng dẫn đúng policy, không gửi trùng |
| INB-AT-16 | Automation trùng event, trùng chào với bot/Meta, rule vừa bị tắt | Áp dụng thứ tự đã chốt, không double-send hoặc job cũ gửi tiếp |
| INB-AT-17 | Mất quyền khi đang mở file/thread/notification | Không tiếp tục lộ nội dung hoặc mutation |
| INB-AT-18 | Mobile/keyboard, tên dài, media tải chậm, thread nhiều tin | Có thể hoàn thành luồng chính, focus/scroll/draft không hỏng |
| INB-AT-19 | Đánh dấu “đã thanh toán” thủ công | Không tạo payment/order/doanh thu giả |
| INB-AT-20 | Entry báo cáo/lead/ads/settings chưa có chức năng tương ứng | Giải thích trạng thái hoặc dẫn đúng module; không có nút bấm giả |

**Điều kiện nhận hoàn thành:** mỗi yêu cầu có task và bằng chứng chạy/test; ghi rõ đầy đủ/đã hoãn/bị chặn bởi provider. Không nhận “giống hệt tất cả” nếu còn mục ĐK chưa xác minh. Các provider phải có ma trận capability được kiểm tra bằng tài khoản thử nghiệm, không dùng khách thật để thử gửi/xóa/chặn.

## 16. Quyết định còn mở và đề xuất triển khai

Tài liệu đưa ra mặc định đề xuất để giảm việc phải đoán; đây chưa phải phê duyệt thay đổi nghiệp vụ.

| Quyết định | Đề xuất | Cần chốt trước |
|---|---|---|
| Shop ↔ bot ↔ channel | Dùng quan hệ chính thức lane A; không tự giới hạn 1:1 chỉ từ hình vẽ. Chốt channel thuộc một shop hay chia sẻ, bot dùng nhiều shop được không; filter bot theo gán hiện tại hay lịch sử | CTX/filter thực tế |
| Ưu tiên, theo dõi, trao đổi thêm | Dấu sao = theo dõi/ưu tiên; trao đổi thêm riêng, có thể thêm thời hạn. Kiểm chứng filter “Ưu tiên” của Meta trước khẳng định tương đương | State model và filter |
| Read state | Giữ trạng thái chung workspace hiện có | Thay đổi semantics read |
| Work state sau tin mới | Xong mở lại; Spam không tự hồi; xóa không tự khôi phục nếu chưa có policy | Lifecycle |
| Tag customer/conversation | Cùng thư viện chuẩn nhưng phạm vi gắn phải tường minh; không tự di chuyển dữ liệu hiện có | CRM/tag persistence |
| Stage/quality/order marker | Tách riêng, chốt danh sách chuẩn và quyền sửa; không gắn vào payment thật | CRM/lead/commerce |
| Xóa, block, report, restore | Xác minh provider và retention; xác nhận phạm vi trước khi làm nút thật | Hành động phá hủy |
| Presence và lịch vắng mặt | Presence cá nhân; lịch/automation channel, ưu tiên human takeover | OPS/automation |
| Persistent draft | Khôi phục sau refresh theo user và ngữ cảnh; chốt thời hạn lưu, vị trí lưu và xử lý dùng chung thiết bị | Draft ngoài phiên |
| Gọi, thanh toán, WhatsApp, Instagram comments | Khảo sát quyền/capability, thử trên tài khoản test; giữ mục trong inventory đến khi có kết luận | Cam kết parity theo provider |
| Chỉ số và lịch nhắc | Chốt định nghĩa nguồn/denominator/timezone; không tự gán số liệu hoặc SLA | Reports/scheduler |
| Lead manager và custom automation builder | Cần khảo sát riêng màn đích, trường, transition và validation | Nhận scope implementation các màn này |

**Thứ tự triển khai đề xuất, không phải bỏ bớt scope:**

1. Chốt quan hệ scope/capability/state; hoàn thiện fixture và acceptance với dữ liệu thử. Không bắt đầu bằng vẽ lại sidebar.
2. Bố cục ba vùng + danh sách/search/filter + thread/composer, giữ mọi hành vi đang chạy. Ưu tiên luồng ít bấm và không mất draft.
3. Assignment, lifecycle, bulk, CRM panel, labels/notes/media/order; kiểm tra hồi quy và phân quyền.
4. Bình luận, automation, tasks/notifications và cài đặt theo capability đã xác minh. Liên kết lead/report đúng module.
5. Kiểm thử đa kênh, cạnh tranh, lỗi và responsive; đối chiếu từng dòng inventory trước công bố parity.

Đây là hợp đồng yêu cầu cho lõi đã khảo sát và danh mục discovery cho các mục ĐK, chưa phải chứng nhận mọi màn phụ đã đủ để triển khai. Claude chỉ nhận từng slice sau khi các decision gate liên quan đã được giải quyết.

Không áp dụng lại ước lượng bốn ngày của task refinement T-086 cho toàn bộ phạm vi này. Full parity cần ước lượng lại theo ma trận đã xác minh, đặc biệt provider permissions, uploads, automation, scheduler, calling và payments.

## 17. Dấu vết khảo sát và độ tin cậy

Quan sát trực tiếp giao diện Chrome profile Tùng, 27/10/2026. Hai ảnh chủ sản phẩm cung cấp là tham chiếu bố cục; ảnh khảo sát chứa dữ liệu thật chỉ lưu tạm ngoài repo, không phát hành cùng tài liệu.

| Bằng chứng | Quan sát xác nhận | Yêu cầu liên quan |
|---|---|---|
| E01 | Header, tab kênh, ba vùng, toolbar thread, composer, profile | UX, LST, MSG, CMP, CRM |
| E02 | Advanced filters: thường dùng, quảng cáo, quality, labels, assignee, status, Xong/Spam; Apply/Clear | INB-FLT-01…10 |
| E03 | Bulk mode, chọn tất cả đang hiển thị và danh mục thao tác | INB-BLK-01…02 |
| E04 | Assignment popover lựa chọn đơn, xóa giao/xác nhận; tooltips dấu sao/Spam/Xong | ASG, STA |
| E05 | Availability online/away và thêm tin vắng mặt | INB-OPS-01 |
| E06 | Saved-reply introduction: cá nhân hóa, link/ảnh, shortcut; thư viện bên trong chưa kiểm chứng | INB-CMP-05 |
| E07 | Customer edit: phone, email, ngày/tháng sinh, địa chỉ/city/state/postcode; menu stop-contact/report | INB-CRM-02, INB-CRM-12 |
| E08 | Order status options, applied/suggested labels, notes và shared images | INB-CRM-05…10 |
| E09 | Inbox settings: messaging, suggestions, calls/hours, ads entry | INB-SET-01…07 |
| E10 | Automation catalog đầy đủ và list có status/name/objective/channel/edit | INB-AUT-01…12 |
| E11 | Messaging insights destination; lead tab/task entry chỉ xác nhận entry | INB-REP-01, INB-LEAD-01, INB-OPS-02 |

**Giới hạn:** không gửi tin, không tạo quảng cáo, không gọi, không bật automation hoặc lưu cài đặt. Không mở các thread chưa đọc để thử. Trong lúc kiểm tra dropdown, một thao tác nhầm đã đổi dấu mốc đơn hàng sang “đã đặt lịch”; đã xóa ngay để trở về trống và xác nhận trên giao diện. Timeline Meta còn một hoạt động của thao tác đó. Không được mô tả khảo sát này là hoàn toàn không có mutation. Đã thông báo chủ sản phẩm; không thử xóa audit/activity để che dấu.

Nguồn web chính thức được thử truy cập nhưng trang trợ giúp chuyển về đăng nhập và trang API không đọc được qua công cụ; vì thế tài liệu không dùng chúng làm bằng chứng cho các con số cửa sổ gửi hay giới hạn API. Trước triển khai, kiểm tra lại [Meta Instagram private replies](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies/) và [Messenger greeting help](https://www.facebook.com/help/1698046970464236/), ghi ngày và version/quyền đã xác minh. Các yêu cầu ĐK là mục tiêu hoặc điểm nghiên cứu, không phải lời khẳng định quyền API hiện tại của Rapiz.

Bản hướng dẫn kỹ thuật và tài liệu hiện trạng: [English implementation handoff](../handoffs/2026-10-27-meta-inbox-spec.md).
