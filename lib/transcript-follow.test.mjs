import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
	return import("./transcript-follow.ts");
}

test("brings the view back to the end whenever a prompt is submitted", async () => {
	const { reduceFollow } = await loadSubject();

	// 提交不看之前的开关：上滚过、暂停跟随的视图也要恢复跟随并回到底部。
	assert.deepEqual(reduceFollow({ type: "submit" }), { paused: false, scrollToEnd: "auto" });
});

test("pauses following on a rail jump and leaves the scrolling to the jump", async () => {
	const { reduceFollow } = await loadSubject();

	assert.deepEqual(reduceFollow({ type: "pause" }), { paused: true, scrollToEnd: null });
});

test("resumes following with a smooth scroll", async () => {
	const { reduceFollow } = await loadSubject();

	assert.deepEqual(reduceFollow({ type: "resume" }), { paused: false, scrollToEnd: "smooth" });
});

test("snaps to the end after a branch or leaf load", async () => {
	const { reduceFollow } = await loadSubject();

	// 整段替换消息后旧位置到新末尾之间没有可看的中间内容，回底直接落位。
	assert.deepEqual(reduceFollow({ type: "load" }), { paused: false, scrollToEnd: "auto" });
});

test("stops following when the user scrolls away from the bottom", async () => {
	const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

	assert.deepEqual(
		reduceFollow({
			type: "scroll",
			userDriven: true,
			distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX + 1,
			movedTowardEnd: true,
		}),
		{ paused: true, scrollToEnd: null },
	);
});

test("keeps following while the user stays at the bottom", async () => {
	const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

	assert.deepEqual(
		reduceFollow({
			type: "scroll",
			userDriven: true,
			distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX,
			movedTowardEnd: true,
		}),
		{ paused: false, scrollToEnd: null },
	);
});

test("leaves the switch alone for scrolling nobody drove", async () => {
	const { reduceFollow } = await loadSubject();

	// 内容增高、行被重新测量引起的滚动不是用户操作，离底部远也不暂停。
	assert.equal(
		reduceFollow({
			type: "scroll",
			userDriven: false,
			distanceFromBottom: 640,
			movedTowardEnd: false,
		}),
		null,
	);
});

test("does not resume following for a height-only observation", async () => {
	const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

	// 距离达标但 scrollTop 没动：内容增高或行重测量，不能把暂停的跟随重新打开。
	assert.equal(
		reduceFollow({
			type: "scroll",
			userDriven: false,
			distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX,
			movedTowardEnd: false,
		}),
		null,
	);
});

test("does not resume following when layout clamps the scroll position", async () => {
	const { reduceFollow } = await loadSubject();

	// 内容收缩把 scrollTop 向下夹到末尾时距离为 0，但位置是变小，不是用户回到末尾。
	assert.equal(
		reduceFollow({
			type: "scroll",
			userDriven: false,
			distanceFromBottom: 0,
			movedTowardEnd: false,
		}),
		null,
	);
});

test("resumes following by position, whoever drove the scroll", async () => {
	const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

	// 恢复只看位置：触控惯性与拖滚动条到底可能远晚于用户意图窗口，那时驱动信息已经
	// 过期（userDriven 为 false），按窗口判定会让视图一直停在暂停。
	assert.deepEqual(
		reduceFollow({
			type: "scroll",
			userDriven: false,
			distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX,
			movedTowardEnd: true,
		}),
		{ paused: false, scrollToEnd: null },
	);
	assert.deepEqual(
		reduceFollow({
			type: "scroll",
			userDriven: false,
			distanceFromBottom: 0,
			movedTowardEnd: true,
		}),
		{ paused: false, scrollToEnd: null },
	);
});
