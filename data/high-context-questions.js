const groups = [
  { day: 1, word: 'accept', variants: [
    ['offer', 'She accepted the job offer yesterday.', '她昨天接受了那份工作邀请。', ['承认', '接受', '拒绝'], 1, 'accept an offer 表示“接受邀请或提议”。'],
    ['fact', 'He finally accepted that the plan had failed.', '他终于承认这个计划失败了。', ['承认；接受事实', '提供', '反对'], 0, 'accept that 后接事实，表示“承认、接受这个事实”。'],
  ] },
  { day: 2, word: 'alien', variants: [
    ['foreigner', 'The law also applies to aliens living in the country.', '这项法律也适用于居住在该国的外国人。', ['外国人', '外星生物', '熟悉的人'], 0, '法律语境中的 alien 可指“外国人、外侨”。'],
    ['unfamiliar', 'The idea of working at night was alien to him.', '夜间工作的想法对他来说很陌生。', ['亲切的', '陌生的；格格不入的', '违法的'], 1, 'be alien to someone 表示“对某人很陌生、格格不入”。'],
  ] },
  { day: 3, word: 'aspect', variants: [
    ['side', 'We discussed every aspect of the proposal.', '我们讨论了这项提议的各个方面。', ['方面', '外观', '距离'], 0, 'every aspect of 表示“……的各个方面”。'],
    ['appearance', 'The building has a rather severe aspect.', '这栋建筑的外观颇为严肃。', ['层面', '外观；样子', '入口'], 1, '描述建筑给人的样子时，aspect 可表示“外观”。'],
  ] },
  { day: 4, word: 'award', variants: [
    ['prize', 'The film won an international award.', '这部电影获得了一个国际奖项。', ['奖金；奖项', '授予', '警告'], 0, 'win an award 中 award 是名词“奖项”。'],
    ['grant', 'The general awarded the officer a medal after the ceremony.', '将军在仪式后向那名军官授予了一枚勋章。', ['拒绝', '授予；颁发', '借入'], 1, 'award someone something 表示“向某人授予某物”。'],
  ] },
  { day: 5, word: 'brief', variants: [
    ['short', 'They had a brief conversation before the meeting.', '会议前他们进行了一次简短交谈。', ['简短的', '诉讼摘要', '详细的'], 0, 'brief 修饰 conversation 时表示“简短的”。'],
    ['inform', 'The officer briefed the team before the operation.', '行动前，负责人向团队介绍了情况。', ['缩短', '介绍情况；作简报', '批评'], 1, 'brief someone 表示“向某人介绍必要情况”。'],
  ] },
  { day: 6, word: 'circular', variants: [
    ['round', 'We sat around a circular table.', '我们围坐在一张圆桌旁。', ['圆形的', '循环的', '传单'], 0, 'circular table 指“圆形的桌子”。'],
    ['leaflet', 'A circular was sent to every household.', '一份通知传单被送到每户人家。', ['圆圈', '传单；通知', '包裹'], 1, 'send a circular 中 circular 是名词“传单、通知”。'],
  ] },
  { day: 7, word: 'compose', variants: [
    ['music', 'She composed the music for the film.', '她为这部电影作曲。', ['组成', '作曲', '拆除'], 1, 'compose music 表示“作曲”。'],
    ['make-up', 'Women compose nearly half of the workforce.', '女性构成了近一半的劳动力。', ['构成；组成', '创作音乐', '竞争'], 0, 'A composes B 表示“A 构成 B”。'],
  ] },
  { day: 8, word: 'core', variants: [
    ['center', 'The apple was rotten at the core.', '这个苹果从果核处开始腐烂。', ['核心；果核', '主要的', '表面'], 0, '苹果内部中心部分的 core 是“果核”。'],
    ['main', 'Trust is a core value of the organization.', '信任是这个组织的一项核心价值。', ['边缘的', '核心的；主要的', '临时的'], 1, 'core 修饰 value 时表示“核心的、主要的”。'],
  ] },
  { day: 9, word: 'deal', variants: [
    ['agreement', 'The two companies finally reached a deal.', '两家公司终于达成了协议。', ['协议；交易', '处理', '发牌'], 0, 'reach a deal 表示“达成协议”。'],
    ['handle', 'This guide explains how to deal with complaints.', '这份指南说明了如何处理投诉。', ['签订协议', '处理；应对', '拒绝'], 1, 'deal with 表示“处理、应对”。'],
  ] },
  { day: 10, word: 'desert', variants: [
    ['land', 'Very little rain falls in the desert.', '沙漠中的降雨量很少。', ['沙漠', '抛弃', '甜点'], 0, '有降雨量的地理语境中，desert 是名词“沙漠”。'],
    ['abandon', 'Many residents deserted the town during the fighting.', '战乱期间，许多居民抛弃了这座城镇。', ['建设', '抛弃；离弃', '穿越沙漠'], 1, 'desert a place 表示“抛弃、离开某地”。'],
  ] },
  { day: 11, word: 'discount', variants: [
    ['price', 'The platform offers a ten percent discount to students.', '这个平台为学生提供九折优惠。', ['折扣', '不相信', '利息'], 0, '百分比和价格语境中的 discount 是“折扣”。'],
    ['dismiss', 'We should not discount the possibility of further delays.', '我们不应忽视进一步延误的可能性。', ['给予折扣', '低估；不全信', '证明'], 1, 'discount a possibility 表示“认为其不重要或不大可能”。'],
  ] },
  { day: 12, word: 'drill', variants: [
    ['tool', 'Use a drill to make a hole in the wall.', '用钻头在墙上打一个孔。', ['钻孔工具；钻头', '训练', '演习警报'], 0, 'make a hole 的工具 drill 是“钻头、电钻”。'],
    ['practice', 'Students wearing school uniforms joined the fire drill.', '穿校服的学生参加了消防演习。', ['钻孔', '演习', '课程考试'], 1, 'fire drill 表示“消防演习”。'],
  ] },
  { day: 13, word: 'energy', variants: [
    ['power', 'The country is investing in renewable energy.', '这个国家正在投资可再生能源。', ['能源', '精力', '情绪'], 0, 'renewable energy 指“可再生能源”。'],
    ['vitality', 'The children were full of energy after lunch.', '午饭后孩子们精力充沛。', ['电力', '精力；活力', '经验'], 1, 'be full of energy 表示“精力充沛”。'],
  ] },
  { day: 14, word: 'exhibit', variants: [
    ['display', 'The museum will exhibit the paintings next month.', '博物馆下个月将展出这些画作。', ['展览；展示', '隐藏', '出售'], 0, '博物馆 exhibit 画作表示“展出、展示”。'],
    ['object', 'The vase is the oldest exhibit in the room.', '这个花瓶是房间里最古老的展品。', ['表现', '展品', '证人'], 1, '可数名词 exhibit 在博物馆语境中表示“展品”。'],
  ] },
  { day: 15, word: 'figure', variants: [
    ['number', 'The latest sales figures are encouraging.', '最新的销售数字令人鼓舞。', ['人物', '数字；数据', '身材'], 1, 'sales figures 表示“销售数字、数据”。'],
    ['person', 'She is a leading figure in modern art.', '她是现代艺术领域的领军人物。', ['图形', '人物', '计算'], 1, 'a leading figure 指“领军人物”。'],
  ] },
  { day: 16, word: 'general', variants: [
    ['overall', 'The report gives a general description of the problem.', '报告对这个问题作了总体描述。', ['将军', '总体的；一般的', '局部的'], 1, 'general description 表示“总体、概括性的描述”。'],
    ['officer', 'The general awarded the officer a medal after the ceremony.', '将军在仪式后向那名军官授予了一枚勋章。', ['将军', '普通人', '记者'], 0, '向军官颁发勋章的 general 是军衔“将军”。'],
  ] },
  { day: 17, word: 'horizon', variants: [
    ['line', 'The sun disappeared below the horizon.', '太阳消失在地平线下。', ['地平线', '视野；眼界', '山顶'], 0, '太阳升落的 horizon 是“地平线”。'],
    ['outlook', 'Travel can broaden a person’s horizons.', '旅行可以开阔一个人的眼界。', ['地平线', '眼界；视野', '路线'], 1, 'broaden one’s horizons 表示“开阔眼界”。'],
  ] },
  { day: 18, word: 'incredible', variants: [
    ['unbelievable', 'His account of the accident sounded incredible.', '他对事故的描述听起来难以置信。', ['难以置信的', '极好的', '准确的'], 0, '描述说法不可信时，incredible 表示“难以置信的”。'],
    ['excellent', 'The view from the mountain was incredible.', '山顶的景色好极了。', ['普通的', '极好的', '虚假的'], 1, '口语中形容景色时，incredible 可表示“极好的、惊人的”。'],
  ] },
  { day: 19, word: 'interest', variants: [
    ['curiosity', 'She has a strong interest in history.', '她对历史有浓厚兴趣。', ['兴趣', '利息', '利益'], 0, 'interest in a subject 表示“对某学科的兴趣”。'],
    ['benefit', 'The decision was made in the public interest.', '这个决定是为了公共利益作出的。', ['兴趣', '利益', '利率'], 1, 'in the public interest 表示“为了公共利益”。'],
  ] },
  { day: 20, word: 'lesson', variants: [
    ['class', 'Our first English lesson starts at nine.', '我们的第一节英语课九点开始。', ['课程；课', '教训', '考试'], 0, '有学科和上课时间时，lesson 表示“一节课”。'],
    ['moral', 'The mistake taught us an important lesson.', '这次错误给了我们一个重要教训。', ['课程', '教训', '奖励'], 1, 'teach someone a lesson 表示“给某人一个教训”。'],
  ] },
  { day: 21, word: 'master', variants: [
    ['owner', 'The dog followed its master home.', '这只狗跟着主人回家。', ['硕士', '主人', '精通'], 1, '动物的 master 指“主人”。'],
    ['learn', 'She mastered the software in a few weeks.', '她在几周内掌握了这款软件。', ['控制别人', '精通；掌握', '制造'], 1, 'master a skill or tool 表示“精通、掌握”。'],
  ] },
  { day: 22, word: 'minute', variants: [
    ['time', 'The train leaves in five minutes.', '火车五分钟后出发。', ['分钟', '极小的', '备忘录'], 0, '数字加 minutes 表示时间单位“分钟”。'],
    ['tiny', 'The scientist noticed a minute difference between the samples.', '科学家注意到样本之间极细微的差别。', ['一分钟的', '细微的', '正式记录的'], 1, 'minute 修饰 difference 时读音不同，表示“极小、细微的”。'],
  ] },
  { day: 23, word: 'narrative', variants: [
    ['story', 'The novel follows a simple narrative.', '这部小说采用了简单的叙事。', ['叙述；故事', '叙述的', '争论'], 0, 'a narrative 中 narrative 是名词“叙述、故事”。'],
    ['style', 'The book uses a first-person narrative style.', '这本书采用第一人称叙事风格。', ['数字的', '叙述的', '客观的'], 1, 'narrative 修饰 style 时是形容词“叙述的”。'],
  ] },
  { day: 24, word: 'offer', variants: [
    ['provide', 'The platform offers a ten percent discount to students.', '这个平台为学生提供九折优惠。', ['提供', '出价', '拒绝'], 0, 'offer a discount 表示“提供优惠”。'],
    ['bid', 'They made an offer of two million dollars for the house.', '他们为这栋房子出价二百万美元。', ['建议', '出价', '供应'], 1, '金额加 for the house 表明 offer 是“出价”。'],
  ] },
  { day: 25, word: 'owe', variants: [
    ['debt', 'I still owe the bank ten thousand dollars.', '我仍欠银行一万美元。', ['欠', '归功于', '支付'], 0, 'owe someone money 表示“欠某人钱”。'],
    ['credit', 'She owes her success to years of practice.', '她把成功归功于多年的练习。', ['欠债', '把……归功于', '反对'], 1, 'owe A to B 表示“把 A 归功于 B”。'],
  ] },
  { day: 26, word: 'pay', variants: [
    ['salary', 'The job offers good pay and flexible hours.', '这份工作薪资不错，时间也灵活。', ['工资', '付费', '罚款'], 0, 'good pay 在工作语境中指“不错的工资”。'],
    ['charge', 'You can pay the bill online.', '你可以在线支付账单。', ['领取工资', '支付', '借款'], 1, 'pay the bill 表示“支付账单”。'],
  ] },
  { day: 27, word: 'platform', variants: [
    ['station', 'The train to Oxford leaves from platform six.', '开往牛津的火车从六号站台发车。', ['网络平台', '站台；月台', '道路'], 1, '火车站和编号语境中的 platform 是“站台”。'],
    ['digital', 'The videos are available on several online platforms.', '这些视频可在多个网络平台观看。', ['平台', '月台', '天花板'], 0, 'online platform 表示“网络平台”。'],
  ] },
  { day: 28, word: 'preface', variants: [
    ['introduction', 'The author explains the change in the preface.', '作者在序言中解释了这一变化。', ['序言', '结论', '索引'], 0, '书中正文之前的 preface 是“序言”。'],
    ['introduce', 'She prefaced her remarks with a brief apology.', '她先简短道歉，然后才开始讲话。', ['总结', '以……作为开场', '删除'], 1, 'preface A with B 表示“用 B 作为 A 的开场”。'],
  ] },
  { day: 29, word: 'proposal', variants: [
    ['plan', 'The committee rejected the budget proposal.', '委员会否决了预算方案。', ['方案；建议', '求婚', '报告'], 0, 'budget proposal 指“预算方案”。'],
    ['marriage', 'She accepted his marriage proposal.', '她接受了他的求婚。', ['工作建议', '求婚', '预算'], 1, 'marriage proposal 固定表示“求婚”。'],
  ] },
  { day: 30, word: 'rate', variants: [
    ['speed', 'The population is growing at a rapid rate.', '人口正以很快的速度增长。', ['速度；比率', '评价', '价格标签'], 0, 'at a rapid rate 表示“以很快的速度”。'],
    ['judge', 'Customers rated the service highly.', '顾客对这项服务评价很高。', ['计算速度', '评价', '降低'], 1, 'rate something highly 表示“给予某事很高评价”。'],
  ] },
  { day: 31, word: 'remain', variants: [
    ['stay', 'Please remain calm during the emergency.', '紧急情况下请保持冷静。', ['保持不变', '剩余物', '离开'], 0, 'remain calm 表示“保持冷静”。'],
    ['ruins', 'The remains of the old wall are still visible.', '旧城墙的遗迹仍然可见。', ['留下', '遗迹；残余', '修复'], 1, '复数名词 remains 可表示“遗迹、残余”。'],
  ] },
  { day: 32, word: 'review', variants: [
    ['study', 'I need to review these words before the test.', '考试前我需要复习这些单词。', ['审查', '复习', '出版'], 1, '考试前 review 学习内容表示“复习”。'],
    ['evaluate', 'The board will review the application next week.', '董事会下周将审查这份申请。', ['复习功课', '审查；评估', '撤回'], 1, '机构 review an application 表示“审查申请”。'],
  ] },
  { day: 33, word: 'service', variants: [
    ['help', 'The hotel provides excellent customer service.', '这家酒店提供出色的客户服务。', ['服务', '维修', '服役'], 0, 'customer service 指“客户服务”。'],
    ['maintenance', 'The car is due for a service next month.', '这辆车下个月该保养了。', ['使用', '维修；保养', '接待'], 1, '车辆 a service 指一次“检修、保养”。'],
  ] },
  { day: 34, word: 'solution', variants: [
    ['answer', 'We need a practical solution to the traffic problem.', '我们需要一个解决交通问题的可行办法。', ['溶液', '解决办法', '题目'], 1, 'solution to a problem 表示“问题的解决办法”。'],
    ['liquid', 'Add the powder to the solution slowly.', '将粉末慢慢加入溶液中。', ['答案', '溶液', '固体'], 1, '加入粉末的液体 solution 是“溶液”。'],
  ] },
  { day: 35, word: 'stamp', variants: [
    ['postage', 'Put a stamp on the envelope.', '在信封上贴一枚邮票。', ['邮票', '跺脚', '印刷机'], 0, '贴在 envelope 上的 stamp 是“邮票”。'],
    ['step', 'He stamped his feet to keep warm.', '他跺脚取暖。', ['贴邮票', '跺脚', '轻声走路'], 1, 'stamp one’s feet 表示“跺脚”。'],
  ] },
  { day: 36, word: 'substance', variants: [
    ['material', 'The police found a dangerous substance in the bag.', '警方在包里发现了一种危险物质。', ['物质', '本质', '形式'], 0, '可装在包里的 substance 是“物质”。'],
    ['essence', 'There is little substance in his argument.', '他的论点没有多少实质内容。', ['材料', '实质；本质', '证据文件'], 1, 'argument 中的 substance 指“实质、本质内容”。'],
  ] },
  { day: 37, word: 'sway', variants: [
    ['swing', 'The trees swayed in the strong wind.', '树木在强风中摇摆。', ['影响', '摇摆', '折断'], 1, '树在风中 sway 表示“摇摆”。'],
    ['influence', 'The speech failed to sway public opinion.', '这场演讲没能影响公众意见。', ['摇晃身体', '影响；说服', '记录'], 1, 'sway public opinion 表示“影响公众意见”。'],
  ] },
  { day: 38, word: 'texture', variants: [
    ['fabric', 'The fabric has a rough texture.', '这种布料手感粗糙。', ['质地；手感', '味道', '颜色'], 0, '描述 fabric 摸起来怎样时，texture 是“质地、手感”。'],
    ['food', 'The sauce gives the dish a smoother texture.', '这种酱汁让菜肴的口感更顺滑。', ['气味', '口感', '温度'], 1, '描述食物入口的感觉时，texture 表示“口感”。'],
  ] },
  { day: 39, word: 'trail', variants: [
    ['path', 'We followed a narrow trail through the forest.', '我们沿着一条狭窄小径穿过森林。', ['小径；路径', '追踪', '足迹'], 0, '穿过森林可行走的 trail 是“小径”。'],
    ['follow', 'A detective trailed the suspect for two days.', '一名侦探跟踪了嫌疑人两天。', ['带路', '追踪；跟踪', '迷路'], 1, 'trail a person 表示“跟踪某人”。'],
  ] },
  { day: 40, word: 'uniform', variants: [
    ['clothing', 'Students wearing school uniforms joined the fire drill.', '穿校服的学生参加了消防演习。', ['制服', '一致的', '便服'], 0, 'school uniform 指“校服”。'],
    ['consistent', 'The walls were painted a uniform shade of grey.', '墙壁被刷成一致的灰色。', ['多样的', '一致的', '临时的'], 1, 'uniform 修饰颜色时表示“均匀一致的”。'],
  ] },
  { day: 41, word: 'version', variants: [
    ['software', 'The monitor displays the latest version of the software.', '这台显示器展示了软件的最新版本。', ['版本', '描述', '翻译'], 0, 'latest version of software 指“软件的最新版本”。'],
    ['account', 'His version of the incident differs from mine.', '他对这件事的说法与我的不同。', ['软件版本', '说法；描述', '证据'], 1, 'someone’s version of an event 指“某人对事件的说法”。'],
  ] },
  { day: 42, word: 'while/whilst', variants: [
    ['during', 'Please wait here while I check the details.', '我核对细节时，请在这里等候。', ['虽然', '在……期间', '因此'], 1, 'while 连接同时发生的动作，表示“在……期间”。'],
    ['although', 'While the task is difficult, it is not impossible.', '虽然任务很困难，但并非不可能。', ['当……时候', '虽然；尽管', '除非'], 1, '句首 while 引出让步，表示“虽然、尽管”。'],
  ] },
];

const questions = [];
groups.forEach((group) => {
  group.variants.forEach((variant) => {
    questions.push({
      id: `high-${group.day}-${group.word.replace(/[^a-z]+/gi, '-')}-${variant[0]}`,
      word: group.word,
      sentence: variant[1],
      translation: variant[2],
      choices: variant[3],
      answer: variant[4],
      explanation: variant[5],
    });
  });
});

module.exports = questions;
