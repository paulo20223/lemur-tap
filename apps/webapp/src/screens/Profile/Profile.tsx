/**
 * Profile page — Profile and Friends (referral) on one screen, switched by the
 * shared <SegmentedToggle> instead of two separate routes/tabs in the nav.
 *
 * The toggle is the page's header and its accessible tab strip; the page mounts
 * on the Friends tab by default (it replaces the former standalone Friends
 * screen). Each panel owns its own data and surface, and both share the
 * "quiet luxury" design system defined once in profile.css.
 */
import { useState } from 'react';
import {
  SegmentedToggle,
  type SegmentOption,
} from '../../components/SegmentedToggle';
import { UserIcon, FriendsIcon } from '../../components/icons';
import { useT } from '../../i18n';
import ProfilePanel from './ProfilePanel';
import ReferralPanel from './ReferralPanel';
import './profile.css';
import './referral.css';

type Tab = 'profile' | 'friends';

export default function Profile() {
  const t = useT();
  // Default to Friends — it was the standalone screen this page replaces.
  const [tab, setTab] = useState<Tab>('friends');

  const segments: SegmentOption<Tab>[] = [
    { value: 'profile', label: t('profile.tabProfile'), Icon: UserIcon },
    { value: 'friends', label: t('profile.tabFriends'), Icon: FriendsIcon },
  ];

  return (
    <div className="screen profile-page">
      <h1 className="sr-only">{t('profile.title')}</h1>

      <div className="profile-page__head">
        <SegmentedToggle
          segments={segments}
          value={tab}
          onChange={setTab}
          label={t('profile.sectionsLabel')}
          idPrefix="profile"
        />
      </div>

      <div
        id="profile-panel-profile"
        role="tabpanel"
        aria-labelledby="profile-tab-profile"
        hidden={tab !== 'profile'}
      >
        {tab === 'profile' && <ProfilePanel />}
      </div>

      <div
        id="profile-panel-friends"
        role="tabpanel"
        aria-labelledby="profile-tab-friends"
        hidden={tab !== 'friends'}
      >
        {tab === 'friends' && <ReferralPanel />}
      </div>
    </div>
  );
}
