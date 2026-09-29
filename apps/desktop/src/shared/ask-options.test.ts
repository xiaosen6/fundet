import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFreeTextAskOptionLabel, visibleAskOptions } from './ask-options.ts';

describe('isFreeTextAskOptionLabel（模型自造自由输入选项识别，规格搬自 Cindy #5198）', () => {
  it('逃生口式选项判定为 true', () => {
    for (const label of [
      '其他（回复说明）',
      '其它（请补充说明）',
      '其他',
      '其他答案',
      '其他选项（请说明）',
      '其他: 请填写',
      'Other',
      'Others',
      'Other (please specify)',
      'Other: please specify',
      'Something else…',
      'その他',
      '기타',
    ]) {
      assert.equal(isFreeTextAskOptionLabel(label), true, label);
    }
  });

  it('实质选项不误判（只认开头 token + 分隔/结尾边界）', () => {
    for (const label of [
      '其他任务',
      '其他供应商',
      'Other tasks',
      'Other providers',
      'Otherwise',
      'その他の質問',
      'Rearrange layout',
      '',
      '   ',
      'sensor_height 要改（回复说明数值）',
      '以上都不是（请说明）',
      'Specify another provider',
      'Enter your own path',
      'Specify later',
    ]) {
      assert.equal(isFreeTextAskOptionLabel(label), false, label);
    }
  });
});

describe('visibleAskOptions', () => {
  it('剔除逃生口选项，保留普通与带描述选项', () => {
    const options = [
      { label: 'React Native', description: '原生端' },
      { label: '其他（回复说明）' },
      { label: 'Expo' },
      { label: 'Other (please specify)' },
    ];
    assert.deepEqual(visibleAskOptions(options), [
      { label: 'React Native', description: '原生端' },
      { label: 'Expo' },
    ]);
  });

  it('全被剔除时返回空列表（调用方退回自由输入）；undefined 容错', () => {
    assert.deepEqual(visibleAskOptions([{ label: '其他' }]), []);
    assert.deepEqual(visibleAskOptions(undefined), []);
  });
});
