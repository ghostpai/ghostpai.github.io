# SO-101 fake-disturbance pairs (paired BY NAME, not by timestamp)

SO-101 replays were filmed but no replay log was recorded, so each folder holds the
injected FIXTURE csv (synthetic t_obs, no real time) plus every video that could be
its replay. Where there is more than one video, pick one and delete the other.

Times are local (CEST), 2026-08-17. Fixture times = original creation (from PVD_backup_20260825).

| folder             | fixture created | candidate videos (recording start)                                   |
|--------------------|-----------------|-----------------------------------------------------------------------|
| fake_clean         | 00:45           | so_final_fake_clean.mp4 (17:47)                                        |
| fake_jitter        | 00:45           | so_fake_jitter.mp4 (10:16), so_fake_jitter_final.mp4 (17:48)           |
| fake_jitter_mild   | 10:39           | fake_jitter_mild.mp4 (10:40), so_fake_jitter_mild.mp4 (18:12)          |
| fake_jitter_severe | 10:39           | so_fake_jitter_severe_final2.mp4 (18:11)                               |
| fake_spike         | 00:45           | so_fake_spike.mp4 (17:50)                                              |
| fake_spike_const0  | 17:58           | so_fake_spike_const.mp4 (18:00), so_fake_spike_const_speed1-35.mp4 (18:01) |
| fake_spike_const   | 18:07           | so_fake_spike_const2_.mp4 (18:09)                                      |

Note: fake_spike_const.csv was created at 18:07, so the 18:00/18:01 videos must be
replays of fake_spike_const0.csv; only the 18:09 video can be fake_spike_const.csv.

No SO video for: fake_seam.csv (fake_seam.mp4 is the roarm replay, 08-25).
Unassigned SO videos from 08-17: PXL_20260817_081241602 (10:12), PXL_20260817_084821829 (10:48),
PXL_20260817_154640633 (17:46), PXL_20260817_161118455 (18:11).
