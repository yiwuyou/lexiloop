# 英语（二）阅读例句与搭配编写说明

2026-10-29，0.7.0。用户指定近十年英语（二），允许替换全部既有词条例句，不受已学范围限制。

2522条机构来源记录对应2514种实际拼写。新库包含696组原创中英例句，按目标词逐一指定；一个自然语境最多用于4个不同目标词，重复来源记录仍保留独立ID与成绩。全部词条均有常用短语或搭配，不能将这一覆盖率解释为每词都有固定习语，亦未统计各搭配在真题中的出现频次。

例句以近十年已公开英语（二）阅读的题材和论证方式为方向，涉及就业与职场、消费与公共服务、教育与文化、技术与隐私、环境与能源等；采用因果、转折、比较、条件等结构。新句并非逐句改写真题，不标注未经核实的真题年份，也不把原创内容称为真题原文。它们用于单词理解，不能代替完整篇章训练或声称具有官方等值难度。

机构原释义、顺序、音频与助记均保留。超出机构原释义的例句用法单独标注，例如toll、stem、latitude；巩固题按实际句中义设置答案，解释中保留机构原释义。旧收藏保存的句子快照继续保留。

`reading-examples.tsv`是编写源，`retained-phrases.json`保留前版83个词的人工表达，`reading-senses.json`是少数补充义说明。运行`node scripts/build-reading-content.js`验证完整覆盖后生成运行库、短语包和完整人工短语表。不会重新生成词表或助记，不读取学习存档。运行库用共享句索引减少重复，短语直接随卡片可用，不依赖网络后补。

参考资料用于核对题材范围或少数词义，不代表对所有例句提供逐句出处或真题频率背书：

- 研招网转载的[2017英语二分析](https://yz.chsi.com.cn/kyzx/en/201612/20161229/1575717421.html)、[2018阅读题材分析](https://yz.chsi.com.cn/kyzx/en/201712/20171225/1645244756.html)：历史题材背景，不作为当前考试大纲。
- [近年英语二文章索引](https://english-exam.lazynote.cn/kaoyan/articles/english-two/)：题材导航，不复制其原文或译文，不采纳其自动难度评级作为本应用保证。
- [Cambridge：dwell on](https://dictionary.cambridge.org/us/dictionary/english/dwell-on)、[toll](https://dictionary.cambridge.org/us/dictionary/english/toll)：搭配义复核。
- [Dictionary.com：pound the pavement](https://www.dictionary.com/browse/pound-the-pavement)、[Cambridge English研究笔记：wicked problems](https://www.cambridgeenglish.org/Images/477901-research-notes-69.pdf)：习语及公共政策语境复核。

自动检查能发现缺词、漏译、重复来源和答案不匹配等结构问题，不能证明每条表达都是最优教学方案；后续仍按实际阅读反馈修订。
